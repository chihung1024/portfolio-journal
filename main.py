import os
import time
from datetime import datetime, timedelta

import requests
import yfinance as yf
import pandas as pd

# ───────────────────────────── 1. 環境變數 ─────────────────────────────
D1_WORKER_URL   = os.getenv("D1_WORKER_URL")
D1_API_KEY      = os.getenv("D1_API_KEY")
GCP_API_URL     = os.getenv("GCP_API_URL")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")  # ★ 新增

# ───────────────────────────── 2. D1 基礎函式 ─────────────────────────────
HEADERS_D1 = {"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"}

def d1_query(sql: str, params=None):
    params = params or []
    r = requests.post(f"{D1_WORKER_URL}/query",
                      json={"sql": sql, "params": params},
                      headers=HEADERS_D1, timeout=30)
    r.raise_for_status()
    return r.json().get("results", [])

def d1_batch(statements: list):
    r = requests.post(f"{D1_WORKER_URL}/batch",
                      json={"statements": statements},
                      headers=HEADERS_D1, timeout=60)
    r.raise_for_status()
    return True

# ───────────────────────────── 3. 取得標的與使用者 ─────────────────────────────
def get_targets():
    symbols = [row["symbol"] for row in
               d1_query("SELECT symbol FROM market_data_coverage")]
    uids = [row["uid"] for row in
            d1_query("SELECT DISTINCT uid FROM transactions")]
    return symbols, uids

# ───────────────────────────── 4. 增量更新 ─────────────────────────────
def fetch_incremental(symbols):
    today = datetime.utcnow().strftime("%Y-%m-%d")
    for sym in symbols:
        tbl = "exchange_rates" if "=" in sym else "price_history"
        latest = d1_query(f"SELECT MAX(date) d FROM {tbl} WHERE symbol = ?", [sym])
        start = (datetime.strptime(latest[0]["d"], "%Y-%m-%d") + timedelta(days=1)
                 ).strftime("%Y-%m-%d") if latest and latest[0]["d"] else "2000-01-01"
        if start >= today:
            continue

        hist = yf.Ticker(sym).history(start=start,
                                      end=(datetime.utcnow()+timedelta(days=1)).strftime("%Y-%m-%d"))
        if hist.empty:
            continue

        stmts = []
        for idx, row in hist.iterrows():
            d = idx.strftime("%Y-%m-%d")
            if pd.notna(row["Close"]):
                stmts.append({"sql": f"INSERT OR IGNORE INTO {tbl} (symbol,date,price) VALUES (?,?,?)",
                              "params": [sym, d, row["Close"]]})
            if "=" not in sym and row["Dividends"] > 0:
                stmts.append({"sql": "INSERT OR IGNORE INTO dividend_history (symbol,date,dividend) VALUES (?,?,?)",
                              "params": [sym, d, row["Dividends"]]})
        if stmts:
            d1_batch(stmts)
            d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?",
                     [today, sym])

# ───────────────────────────── 5. 觸發重算 ─────────────────────────────
def trigger_recalculations(uids):
    if not (GCP_API_URL and INTERNAL_API_KEY):
        print("缺少 GCP_API_URL 或 INTERNAL_API_KEY，跳過觸發重算")
        return
    headers = {
        "Content-Type": "application/json",
        "X-API-KEY": D1_API_KEY,
        "x-internal-key": INTERNAL_API_KEY,   # ★ 關鍵 header
    }
    for uid in uids:
        r = requests.post(GCP_API_URL,
                          json={"action": "recalculate", "data": {"uid": uid}},
                          headers=headers, timeout=30)
        if r.status_code == 200:
            print(f"✅ 成功觸發重算: {uid}")
        else:
            print(f"❌ 重算失敗 {uid}: {r.status_code} {r.text}")
        time.sleep(1)

# ───────────────────────────── 6. 主流程 ─────────────────────────────
if __name__ == "__main__":
    print(f"=== 平日增量更新開始 {datetime.now():%Y-%m-%d %H:%M:%S} ===")
    syms, uids = get_targets()
    fetch_incremental(syms)
    trigger_recalculations(uids)
    print("=== 平日增量更新結束 ===")
