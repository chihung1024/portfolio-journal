import os
import time
from datetime import datetime

import pandas as pd
import requests
import yfinance as yf

# ──────────────────────────────── 1. 環境變數 ────────────────────────────────
D1_WORKER_URL    = os.getenv("D1_WORKER_URL")
D1_API_KEY       = os.getenv("D1_API_KEY")
GCP_API_URL      = os.getenv("GCP_API_URL")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")    # ← Cloud Run 與 GitHub 必須同值

# ──────────────────────────────── 2. D1 輔助函式 ────────────────────────────────
def d1_query(sql, params=None):
    params = params or []
    if not (D1_WORKER_URL and D1_API_KEY):
        print("FATAL: 缺少 D1_WORKER_URL 或 D1_API_KEY")
        return None
    try:
        r = requests.post(
            f"{D1_WORKER_URL}/query",
            json={"sql": sql, "params": params},
            headers={"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"},
            timeout=30,
        )
        r.raise_for_status()
        return r.json().get("results", [])
    except Exception as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return None


def d1_batch(statements):
    if not (D1_WORKER_URL and D1_API_KEY):
        print("FATAL: 缺少 D1_WORKER_URL 或 D1_API_KEY")
        return False
    try:
        r = requests.post(
            f"{D1_WORKER_URL}/batch",
            json={"statements": statements},
            headers={"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"},
            timeout=60,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False


# ──────────────────────────────── 3. 取得標的與使用者 ────────────────────────────────
def get_full_refresh_targets():
    print("→ 取得需要完整刷新的標的…")
    targets = d1_query("SELECT symbol, earliest_date FROM market_data_coverage") or []
    uids = [
        row["uid"]
        for row in (d1_query("SELECT DISTINCT uid FROM transactions") or [])
        if row.get("uid")
    ]
    print(f"  標的數: {len(targets)}，使用者數: {len(uids)} {uids}")
    return targets, uids


# ──────────────────────────────── 4. 抓取並覆蓋市場數據 ────────────────────────────────
def fetch_and_overwrite_market_data(targets):
    if not targets:
        print("→ 沒有標的需要刷新")
        return

    today = datetime.now().strftime("%Y-%m-%d")

    for tgt in targets:
        sym, start = tgt.get("symbol"), tgt.get("earliest_date")
        if not (sym and start):
            continue

        is_fx   = "=" in sym
        tbl     = "exchange_rates" if is_fx else "price_history"

        print(f"\n--- {sym}  自 {start} 起 ---")
        for attempt in range(3):
            try:
                hist = yf.Ticker(sym).history(
                    start=start, interval="1d",
                    auto_adjust=False, back_adjust=False,
                )

                if hist.empty:
                    print("  ⚠️  無資料")
                    break

                print(f"  下載 {len(hist)} 筆")

                stmts = [
                    {"sql": f"DELETE FROM {tbl} WHERE symbol = ?", "params": [sym]}
                ]
                if not is_fx:
                    stmts.append({"sql": "DELETE FROM dividend_history WHERE symbol = ?", "params": [sym]})

                for idx, row in hist.iterrows():
                    date = idx.strftime("%Y-%m-%d")
                    price = row["Close"]
                    if pd.notna(price):
                        stmts.append(
                            {"sql": f"INSERT INTO {tbl} (symbol, date, price) VALUES (?, ?, ?)",
                             "params": [sym, date, price]}
                        )
                    if not is_fx and row.get("Dividends", 0) > 0:
                        stmts.append(
                            {"sql": "INSERT INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)",
                             "params": [sym, date, row["Dividends"]]}
                        )

                if d1_batch(stmts):
                    print("  ✅ 覆蓋完成")
                    d1_query(
                        "UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?",
                        [today, sym],
                    )
                else:
                    print("  ❌ 覆蓋失敗")
                break

            except Exception as e:
                print(f"  ERROR ({attempt+1}/3): {e}")
                if attempt < 2:
                    time.sleep(5)


# ──────────────────────────────── 5. 觸發投資組合重算 ────────────────────────────────
def trigger_recalculations(uids):
    if not uids:
        print("→ 沒有使用者需要重算")
        return
    if not (GCP_API_URL and D1_API_KEY and INTERNAL_API_KEY):
        print("→ 缺少 GCP_API_URL / D1_API_KEY / INTERNAL_API_KEY，跳過重算")
        return

    headers = {
        "Content-Type": "application/json",
        "X-API-KEY": D1_API_KEY,
        "x-internal-key": INTERNAL_API_KEY,
    }

    print(f"\n→ 觸發 {len(uids)} 位使用者重算")
    for uid in uids:
        try:
            r = requests.post(
                GCP_API_URL,
                json={"action": "recalculate", "data": {"uid": uid}},
                headers=headers,
                timeout=30,
            )
            if r.status_code == 200:
                print(f"  ✅ {uid}")
            else:
                print(f"  ❌ {uid} → {r.status_code}: {r.text}")
        except Exception as e:
            print(f"  ERROR {uid}: {e}")
        time.sleep(1)               # 限流


# ──────────────────────────────── 6. 主流程 ────────────────────────────────
if __name__ == "__main__":
    print(f"=== 週末完整校驗開始 {datetime.now():%Y-%m-%d %H:%M:%S} ===")

    targets, uids = get_full_refresh_targets()
    fetch_and_overwrite_market_data(targets)
    trigger_recalculations(uids)

    print("=== 週末完整校驗結束 ===")
