import os
import time
import json
from datetime import datetime, timedelta
from itertools import islice

import requests
import pandas as pd
import yfinance as yf

# =====================================================================================
#  Python 每日增量更新腳本 (v3.5) – 批次抓價 + D1 冪等更新
# =====================================================================================

# ---------- 環境變數 ----------
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY     = os.environ.get("D1_API_KEY")
GCP_API_URL    = os.environ.get("GCP_API_URL")
GCP_API_KEY    = D1_API_KEY                # 與 D1 共用

# ---------- D1 Helper ----------
def d1_query(sql, params=None):
    params = params or []
    try:
        r = requests.post(
            f"{D1_WORKER_URL}/query",
            json={"sql": sql, "params": params},
            headers={"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("results", [])
    except Exception as e:
        print(f"FATAL: D1 查詢失敗 → {e}")
        return None


def d1_batch(statements):
    try:
        r = requests.post(
            f"{D1_WORKER_URL}/batch",
            json={"statements": statements},
            headers={"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"},
            timeout=30,
        )
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"FATAL: D1 批次操作失敗 → {e}")
        return False


# ---------- 決定要更新哪些標的 ----------
def get_update_targets():
    """
    綜合持股、Benchmark 與幣別推算匯率，回傳 (symbols, uids)
    """
    print("掃描資料庫，收集待更新標的…")
    all_symbols           = set()
    currency_to_fx_symbol = {"USD": "TWD=X", "HKD": "HKDTWD=X", "JPY": "JPYTWD=X"}

    # 1. 用戶持股
    for row in d1_query("SELECT DISTINCT symbol, currency FROM holdings") or []:
        all_symbols.add(row["symbol"])
        ccy = row.get("currency")
        if ccy in currency_to_fx_symbol:
            all_symbols.add(currency_to_fx_symbol[ccy])

    # 2. Benchmark
    for row in d1_query("SELECT DISTINCT value AS symbol FROM controls WHERE key='benchmarkSymbol'") or []:
        all_symbols.add(row["symbol"])

    # 3. 活躍使用者
    uids = [r["uid"] for r in d1_query("SELECT DISTINCT uid FROM transactions") or [] if r.get("uid")]

    print(f"✔ 需更新標的 {len(all_symbols)} 檔, 活躍使用者 {len(uids)} 位")
    return sorted(all_symbols), uids


# ---------- 工具：列表切片 ----------
def chunks(iterable, size):
    it = iter(iterable)
    for first in it:
        yield [first] + list(islice(it, size - 1))


# ---------- 主要：抓價 + 寫入 ----------
CHUNK_SIZE      = 40
DOWNLOAD_PARAMS = dict(interval="1d", auto_adjust=False, back_adjust=False, progress=False, threads=True)


def build_start_date_map(symbols):
    """
    查詢每檔 symbol 應從何日開始抓價，回傳 dict[symbol] = 'YYYY-MM-DD'
    """
    today = datetime.now().strftime("%Y-%m-%d")
    out   = {}

    for sym in symbols:
        is_fx      = "=" in sym
        price_table = "exchange_rates" if is_fx else "price_history"

        latest = d1_query(f"SELECT MAX(date) AS d FROM {price_table} WHERE symbol=?", [sym])
        if latest and latest[0]["d"]:
            start = datetime.strptime(latest[0]["d"][:10], "%Y-%m-%d") + timedelta(days=1)
        else:
            # 若無歷史價格，fallback 至最早交易日或 2000-01-01
            tx = d1_query("SELECT MIN(date) AS d FROM transactions WHERE symbol=?", [sym])
            if tx and tx[0]["d"]:
                start = datetime.strptime(tx[0]["d"][:10], "%Y-%m-%d")
            else:
                start = datetime(2000, 1, 1)
        # 已經是最新就仍從今天抓，避免跳日
        out[sym] = max(start, datetime.strptime(today, "%Y-%m-%d")).strftime("%Y-%m-%d")
    return out


def fetch_and_append_market_data(symbols):
    if not symbols:
        print("⚠ 找不到任何標的需要更新")
        return

    print("\n=== [Phase-1] 計算各標的起始日 ===")
    start_map   = build_start_date_map(symbols)
    today_plus1 = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    # ---------- 批次下載 ----------
    for batch in chunks(symbols, CHUNK_SIZE):
        batch_earliest = min(start_map[s] for s in batch)
        print(f"\n=== [Phase-2] 批次下載 {len(batch)} 檔 (自 {batch_earliest}) ===")

        df = yf.download(batch, start=batch_earliest, end=today_plus1, **DOWNLOAD_PARAMS)
        if df.empty:
            print("⚠ yfinance 回傳空資料，略過此批")
            continue

        # 統一成 MultiIndex
        if not isinstance(df.columns, pd.MultiIndex):
            df = pd.concat({batch[0]: df}, axis=1)

        # ---------- 寫入 staging ----------
        for sym in batch:
            sub = df[sym].dropna(how="all")
            if sub.empty:
                continue

            is_fx               = "=" in sym
            price_staging_table = "exchange_rates_staging" if is_fx else "price_history_staging"
            div_staging_table   = "dividend_history_staging"

            ops = [{"sql": f"DELETE FROM {price_staging_table} WHERE symbol=?", "params": [sym]}]
            if not is_fx:
                ops.append({"sql": f"DELETE FROM {div_staging_table} WHERE symbol=?", "params": [sym]})

            for date_idx, row in sub.iterrows():
                d_str = date_idx.strftime("%Y-%m-%d")
                if pd.notna(row["Close"]):
                    ops.append(
                        {
                            "sql": f"INSERT INTO {price_staging_table} (symbol,date,price) VALUES (?,?,?)",
                            "params": [sym, d_str, row["Close"]],
                        }
                    )
                if not is_fx and row.get("Dividends", 0) > 0:
                    ops.append(
                        {
                            "sql": f"INSERT INTO {div_staging_table} (symbol,date,dividend) VALUES (?,?,?)",
                            "params": [sym, d_str, row["Dividends"]],
                        }
                    )

            if d1_batch(ops):
                print(f"✔ {sym} → staging 完成 ({len(sub)} 天)")
            else:
                print(f"✖ {sym} staging 失敗，跳過")

    # ---------- 從 staging upsert 正式表 ----------
    print("\n=== [Phase-3] staging → 正式表 ===")
    today = datetime.now().strftime("%Y-%m-%d")
    for sym in symbols:
        is_fx      = "=" in sym
        price_tbl  = "exchange_rates" if is_fx else "price_history"
        price_stg  = f"{price_tbl}_staging"
        div_stg    = "dividend_history_staging"

        ops = [
            {
                "sql": f"""
                    INSERT INTO {price_tbl} (symbol,date,price)
                    SELECT symbol,date,price FROM {price_stg} WHERE symbol=?
                    ON CONFLICT(symbol,date) DO UPDATE SET price=excluded.price;
                """,
                "params": [sym],
            }
        ]

        if not is_fx:
            ops.append(
                {
                    "sql": """
                        INSERT INTO dividend_history (symbol,date,dividend)
                        SELECT symbol,date,dividend FROM dividend_history_staging WHERE symbol=?
                        ON CONFLICT(symbol,date) DO UPDATE SET dividend=excluded.dividend;
                    """,
                    "params": [sym],
                }
            )

        if d1_batch(ops):
            d1_query(
                "UPDATE market_data_coverage SET last_updated=? WHERE symbol=?", [today, sym]
            )
            print(f"✔ {sym} 正式表 upsert 完成")
        else:
            print(f"✖ {sym} upsert 失敗")


# ---------- 觸發 GCP 重算 ----------
def trigger_recalculations(uids):
    if not uids or not GCP_API_URL or not GCP_API_KEY:
        print("跳過重算：缺少使用者或 GCP 設定")
        return

    key = os.environ.get("SERVICE_ACCOUNT_KEY")
    if not key:
        print("FATAL: SERVICE_ACCOUNT_KEY 未設定")
        return

    try:
        r = requests.post(
            GCP_API_URL,
            json={"action": "recalculate_all_users"},
            headers={
                "X-API-KEY": GCP_API_KEY,
                "Content-Type": "application/json",
                "X-Service-Account-Key": key,
            },
            timeout=30,
        )
        if r.status_code == 200:
            print("✔ 已觸發所有使用者重算")
        else:
            print(f"✖ 重算 API 回傳 {r.status_code}: {r.text}")
    except Exception as e:
        print(f"FATAL: 呼叫重算 API 失敗 → {e}")


# ---------- main ----------
if __name__ == "__main__":
    print(f"\n=== Daily Market Update (v3.5) – {datetime.now():%Y-%m-%d %H:%M:%S} ===")
    symbols, uids = get_update_targets()
    fetch_and_append_market_data(symbols)
    trigger_recalculations(uids)
    print("=== Script finished ===\n")
