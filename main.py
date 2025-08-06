import os
import time
from datetime import datetime, timedelta
import requests
import pandas as pd
import yfinance as yf

# ──────────────────────────────── 1. 環境變數 ────────────────────────────────
D1_WORKER_URL = os.getenv("D1_WORKER_URL")
D1_API_KEY     = os.getenv("D1_API_KEY")
GCP_API_URL    = os.getenv("GCP_API_URL")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")          # ★ 週日版也會用到

# ──────────────────────────────── 2. D1 輔助函式 ────────────────────────────────
def _d1_call(endpoint: str, payload: dict):
    url = f"{D1_WORKER_URL}/{endpoint}"
    headers = {"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"}
    r = requests.post(url, json=payload, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json().get("results", [])

def d1_query(sql, params=None):
    return _d1_call("query", {"sql": sql, "params": params or []})

def d1_batch(statements):
    _d1_call("batch", {"statements": statements})
    return True

# ──────────────────────────────── 3. 取得需要更新的標的及使用者 ────────────────────────────────
def get_targets():
    symbols = [row["symbol"]
               for row in d1_query("SELECT symbol FROM market_data_coverage")]
    uids = [row["uid"]
            for row in d1_query("SELECT DISTINCT uid FROM transactions")]
    return symbols, uids

# ──────────────────────────────── 4. 增量抓取 ────────────────────────────────
def fetch_incremental(symbols):
    if not symbols:
        return
    today = datetime.utcnow().strftime("%Y-%m-%d")
    for sym in symbols:
        is_fx   = "=" in sym
        tbl     = "exchange_rates" if is_fx else "price_history"
        latest  = d1_query(f"SELECT MAX(date) AS d FROM {tbl} WHERE symbol = ?", [sym])
        start   = "2000-01-01" if not latest[0]["d"] else (
                  datetime.strptime(latest[0]["d"][:10], "%Y-%m-%d") + timedelta(days=1)
                  ).strftime("%Y-%m-%d")
        if start >= today:
            continue

        hist = yf.Ticker(sym).history(start=start,
                                      end=(datetime.utcnow()+timedelta(days=1)).strftime("%Y-%m-%d"),
                                      interval="1d", auto_adjust=False, back_adjust=False)

        if hist.empty:
            continue

        stmts = []
        for idx, row in hist.iterrows():
            d = idx.strftime("%Y-%m-%d")
            if pd.notna(row["Close"]):
                stmts.append({"sql": f"INSERT OR IGNORE INTO {tbl} (symbol,date,price) VALUES (?,?,?)",
                              "params": [sym, d, row["Close"]]})
            if not is_fx and row["Dividends"] > 0:
                stmts.append({"sql": "INSERT OR IGNORE INTO dividend_history (symbol,date,dividend) VALUES (?,?,?)",
                              "params": [sym, d, row["Dividends"]]})
        d1_batch(stmts)
        d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?",
                 [today, sym])

# ──────────────────────────────── 5. 觸發重算 ────────────────────────────────
def trigger_recalc(uids):
    if not (GCP_API_URL and INTERNAL_API_KEY and D1_API_KEY):
        return
    headers = {
        "Content-Type": "application/json",
        "X-API-KEY": D1_API_KEY,
        "x-internal-key": INTERNAL_API_KEY,          # ★ 與週末腳本統一
    }
    for uid in uids:
        requests.post(GCP_API_URL,
                      json={"action": "recalculate", "data": {"uid": uid}},
                      headers=headers, timeout=30)
        time.sleep(1)

# ──────────────────────────────── 6. 主流程 ────────────────────────────────
if __name__ == "__main__":
    print("=== 平日增量更新開始 ===")
    syms, uids = get_targets()
    fetch_incremental(syms)
    trigger_recalc(uids)
    print("=== 平日增量更新結束 ===")
