import os
import time
from datetime import datetime, timedelta
from itertools import islice

import pandas as pd
import requests
import yfinance as yf

# ============================================================================
#  Daily Incremental Market Updater  –  v3.6  (batch download + safe dates)
# ============================================================================

D1_WORKER_URL = os.getenv("D1_WORKER_URL")
D1_API_KEY    = os.getenv("D1_API_KEY")
GCP_API_URL   = os.getenv("GCP_API_URL")
GCP_API_KEY   = D1_API_KEY

# ---------------------- D1 helper ----------------------
HEADERS = {"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"}


def d1_query(sql: str, params=None):
    try:
        r = requests.post(f"{D1_WORKER_URL}/query",
                          json={"sql": sql, "params": params or []},
                          headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.json().get("results", [])
    except Exception as e:
        print(f"[FATAL] D1 query failed → {e}")
        return None


def d1_batch(statements):
    try:
        r = requests.post(f"{D1_WORKER_URL}/batch",
                          json={"statements": statements},
                          headers=HEADERS, timeout=30)
        r.raise_for_status()
        return True
    except Exception as e:
        print(f"[FATAL] D1 batch failed → {e}")
        return False


# ---------------------- targets ----------------------
def get_update_targets():
    print("📋  Gathering symbols & users …")
    syms, uids = set(), []

    ccy_fx = {"USD": "TWD=X", "HKD": "HKDTWD=X", "JPY": "JPYTWD=X"}

    # holdings
    for r in d1_query("SELECT DISTINCT symbol, currency FROM holdings") or []:
        syms.add(r["symbol"])
        if r.get("currency") in ccy_fx:
            syms.add(ccy_fx[r["currency"]])

    # benchmark
    for r in d1_query("SELECT DISTINCT value AS symbol FROM controls WHERE key='benchmarkSymbol'") or []:
        syms.add(r["symbol"])

    # active users
    uids = [r["uid"] for r in d1_query("SELECT DISTINCT uid FROM transactions") or [] if r.get("uid")]

    print(f"✔  {len(syms)} symbols, {len(uids)} active users")
    return sorted(syms), uids


# ---------------------- utils ----------------------
def chunks(lst, size):
    it = iter(lst)
    for first in it:
        yield [first] + list(islice(it, size - 1))


# ---------------------- core ----------------------
CHUNK = 40
DL_OPTS = dict(interval="1d", auto_adjust=False, back_adjust=False,
               progress=False, threads=True)


def build_start_map(symbols):
    """Return dict[symbol] -> ISO start_date (≤ today)"""
    today = datetime.now().date()
    out = {}

    for s in symbols:
        tbl = "exchange_rates" if "=" in s else "price_history"
        latest = d1_query(f"SELECT MAX(date) d FROM {tbl} WHERE symbol=?", [s])
        if latest and latest[0]["d"]:
            start = datetime.strptime(latest["d"][:10], "%Y-%m-%d").date() + timedelta(days=1)
        else:
            tx = d1_query("SELECT MIN(date) d FROM transactions WHERE symbol=?", [s])
            start = datetime.strptime(tx[0]["d"][:10], "%Y-%m-%d").date() if tx and tx["d"] else datetime(2000, 1, 1).date()

        if start > today:
            start = today                                   # 不向未來要資料
        out[s] = start.isoformat()
    return out


def fetch_and_append_market_data(symbols):
    if not symbols:
        print("⚠  No symbols to update")
        return

    start_map = build_start_map(symbols)
    end_str = datetime.now().date().isoformat()

    # ---------- batch download ----------
    for batch in chunks(symbols, CHUNK):
        earliest = min(start_map[s] for s in batch)
        print(f"\n⬇  Downloading {len(batch)} symbols from {earliest} → {end_str}")
        df = yf.download(batch, start=earliest, end=end_str, **DL_OPTS)

        if df.empty:
            print("⚠  Empty dataframe, skip batch")
            continue

        if not isinstance(df.columns, pd.MultiIndex):
            df = pd.concat({batch[0]: df}, axis=1)          # single symbol fallback

        # ---------- staging ----------
        for sym in batch:
            sub = df[sym].dropna(how="all")
            if sub.empty:
                print(f"  ↳ {sym} has no new rows")
                continue

            is_fx = "=" in sym
            price_stg = "exchange_rates_staging" if is_fx else "price_history_staging"
            div_stg   = "dividend_history_staging"

            ops = [{"sql": f"DELETE FROM {price_stg} WHERE symbol=?", "params": [sym]}]
            if not is_fx:
                ops.append({"sql": f"DELETE FROM {div_stg} WHERE symbol=?", "params": [sym]})

            for date_idx, row in sub.iterrows():
                d = date_idx.strftime("%Y-%m-%d")
                if pd.notna(row["Close"]):
                    ops.append({"sql": f"INSERT INTO {price_stg} (symbol,date,price) VALUES (?,?,?)",
                                "params": [sym, d, row["Close"]]})
                if not is_fx and row.get("Dividends", 0) > 0:
                    ops.append({"sql": f"INSERT INTO {div_stg} (symbol,date,dividend) VALUES (?,?,?)",
                                "params": [sym, d, row["Dividends"]]})

            if d1_batch(ops):
                print(f"  ↳ {sym} staged ({len(sub)} rows)")
            else:
                print(f"  ↳ {sym} staging failed")

    # ---------- upsert ----------
    print("\n🗄  Committing staging tables …")
    today = datetime.now().date().isoformat()
    for sym in symbols:
        is_fx = "=" in sym
        price_tbl = "exchange_rates" if is_fx else "price_history"
        price_stg = f"{price_tbl}_staging"
        div_stg   = "dividend_history_staging"

        ops = [{
            "sql": f"INSERT INTO {price_tbl} (symbol,date,price) "
                   f"SELECT symbol,date,price FROM {price_stg} WHERE symbol=? "
                   f"ON CONFLICT(symbol,date) DO UPDATE SET price=excluded.price;",
            "params": [sym]
        }]

        if not is_fx:
            ops.append({
                "sql": "INSERT INTO dividend_history (symbol,date,dividend) "
                       "SELECT symbol,date,dividend FROM dividend_history_staging WHERE symbol=? "
                       "ON CONFLICT(symbol,date) DO UPDATE SET dividend=excluded.dividend;",
                "params": [sym]
            })

        if d1_batch(ops):
            d1_query("UPDATE market_data_coverage SET last_updated=? WHERE symbol=?", [today, sym])
            print(f"  ↳ {sym} committed")
        else:
            print(f"  ↳ {sym} commit failed")


# ---------------------- GCP recalc ----------------------
def trigger_recalculations(uids):
    if not (uids and GCP_API_URL and GCP_API_KEY):
        print("ℹ  Skip recalc (no users or GCP config)")
        return

    key = os.getenv("SERVICE_ACCOUNT_KEY")
    if not key:
        print("[FATAL] SERVICE_ACCOUNT_KEY missing")
        return

    try:
        r = requests.post(GCP_API_URL, json={"action": "recalculate_all_users"},
                          headers={"X-API-KEY": GCP_API_KEY,
                                   "Content-Type": "application/json",
                                   "X-Service-Account-Key": key},
                          timeout=30)
        if r.status_code == 200:
            print("✔  Triggered portfolio recalculation")
        else:
            print(f"[ERROR] Recalc API {r.status_code}: {r.text}")
    except Exception as e:
        print(f"[FATAL] Recalc request failed → {e}")


# ---------------------- main ----------------------
if __name__ == "__main__":
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n=== Market updater v3.6  @ {ts} ===")
    symbols, uids = get_update_targets()
    fetch_and_append_market_data(symbols)
    trigger_recalculations(uids)
    print("=== Done ===\n")
