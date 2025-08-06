import os
import time
from datetime import datetime

import pandas as pd
import requests
import yfinance as yf

# =========================================================================================
#  Python 週末完整校驗腳本 (v1.0) —— 完整覆蓋版
# =========================================================================================

# ──────────────────────────────── 1. 讀取環境變數 ────────────────────────────────
D1_WORKER_URL   = os.getenv("D1_WORKER_URL")
D1_API_KEY      = os.getenv("D1_API_KEY")
GCP_API_URL     = os.getenv("GCP_API_URL")
INTERNAL_API_KEY= os.getenv("INTERNAL_API_KEY")         # ← 必填，否則後續跳過重算

# ──────────────────────────────── 2. D1 操作輔助函式 ────────────────────────────────
def d1_query(sql, params=None):
    """通用 D1 查詢"""
    if params is None:
        params = []
    if not D1_WORKER_URL or not D1_API_KEY:
        print("FATAL: 缺少 D1_WORKER_URL 或 D1_API_KEY")
        return None
    try:
        resp = requests.post(
            f"{D1_WORKER_URL}/query",
            json={"sql": sql, "params": params},
            headers={"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])
    except Exception as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return None


def d1_batch(statements):
    """通用 D1 批次操作"""
    if not D1_WORKER_URL or not D1_API_KEY:
        print("FATAL: 缺少 D1_WORKER_URL 或 D1_API_KEY")
        return False
    try:
        resp = requests.post(
            f"{D1_WORKER_URL}/batch",
            json={"statements": statements},
            headers={"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"},
            timeout=60,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False


# ──────────────────────────────── 3. 取待刷新標的 & 使用者 ────────────────────────────────
def get_full_refresh_targets():
    print("正在從 D1 取得需要完整刷新的金融商品…")
    targets = d1_query("SELECT symbol, earliest_date FROM market_data_coverage")
    if targets is None:
        return [], []

    uids = [
        row["uid"]
        for row in d1_query("SELECT DISTINCT uid FROM transactions") or []
        if row.get("uid")
    ]

    print(f"找到 {len(targets)} 個標的，{len(uids)} 位使用者: {uids}")
    return targets, uids


# ──────────────────────────────── 4. 抓取並覆蓋市場數據 ────────────────────────────────
def fetch_and_overwrite_market_data(targets):
    if not targets:
        print("沒有需要刷新的標的。")
        return

    today = datetime.now().strftime("%Y-%m-%d")

    for tgt in targets:
        symbol      = tgt.get("symbol")
        start_date  = tgt.get("earliest_date")
        if not symbol or not start_date:
            continue

        is_fx      = "=" in symbol
        price_tbl  = "exchange_rates" if is_fx else "price_history"

        print(f"\n--- 處理 {symbol}（自 {start_date} 起）---")
        for attempt in range(3):
            try:
                hist = yf.Ticker(symbol).history(
                    start=start_date,
                    interval="1d",
                    auto_adjust=False,
                    back_adjust=False,
                )

                if hist.empty:
                    print(f"警告: 找不到 {symbol} 歷史數據")
                    break

                print(f"抓取到 {len(hist)} 筆資料。")

                stmts = [
                    {"sql": f"DELETE FROM {price_tbl} WHERE symbol = ?", "params": [symbol]}
                ]
                if not is_fx:
                    stmts.append({"sql": "DELETE FROM dividend_history WHERE symbol = ?", "params": [symbol]})

                for idx, row in hist.iterrows():
                    date = idx.strftime("%Y-%m-%d")
                    price = row["Close"]
                    if pd.notna(price):
                        stmts.append(
                            {"sql": f"INSERT INTO {price_tbl} (symbol, date, price) VALUES (?, ?, ?)",
                             "params": [symbol, date, price]}
                        )
                    if not is_fx and row.get("Dividends", 0) > 0:
                        stmts.append(
                            {"sql": "INSERT INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)",
                             "params": [symbol, date, row["Dividends"]]}
                        )

                if d1_batch(stmts):
                    print("✅ 成功覆蓋到 D1")
                    d1_query(
                        "UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?",
                        [today, symbol],
                    )
                else:
                    print("❌ 覆蓋失敗")
                break

            except Exception as e:
                print(f"ERROR ({attempt + 1}/3): {e}")
                if attempt < 2:
                    print("5 秒後重試…")
                    time.sleep(5)


# ──────────────────────────────── 5. 觸發投資組合重算 ────────────────────────────────
def trigger_recalculations(uids):
    if not uids:
        print("沒有使用者需要重算。")
        return
    if not (GCP_API_URL and D1_API_KEY and INTERNAL_API_KEY):
        print("警告: 缺少必要 API Key，跳過重算。")
        return

    headers = {
        "Content-Type": "application/json",
        "X-API-KEY": D1_API_KEY,
        "x-internal-key": INTERNAL_API_KEY,        # ← 內部通道金鑰
    }

    print(f"\n--- 為 {len(uids)} 位使用者觸發重算 ---")
    for uid in uids:
        payload = {"action": "recalculate", "data": {"uid": uid}}
        try:
            r = requests.post(GCP_API_URL, json=payload, headers=headers, timeout=30)
            if r.status_code == 200:
                print(f"✅ 成功: {uid}")
            else:
                print(f"❌ 失敗 {uid} → {r.status_code}: {r.text}")
        except Exception as e:
            print(f"ERROR: 觸發 {uid} 重算失敗: {e}")
        time.sleep(1)     # 避免突發流量


# ──────────────────────────────── 6. 主流程 ────────────────────────────────
if __name__ == "__main__":
    print(f"\n=== 週末市場數據完整校驗腳本啟動 {datetime.now():%Y-%m-%d %H:%M:%S} ===")

    targets, uids = get_full_refresh_targets()
    fetch_and_overwrite_market_data(targets)
    trigger_recalculations(uids)

    print("=== 腳本結束 ===\n")
