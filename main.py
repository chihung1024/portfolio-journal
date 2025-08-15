import os
from datetime import datetime, timedelta, date
from itertools import islice
import time

import pandas as pd
import requests
import yfinance as yf

# ============================================================================
#  Daily Incremental Market Updater  –  v3.7 (bug-fix: list→dict index)
# ============================================================================

D1_WORKER_URL = os.getenv("D1_WORKER_URL")
D1_API_KEY    = os.getenv("D1_API_KEY")
GCP_API_URL   = os.getenv("GCP_API_URL")
GCP_API_KEY   = D1_API_KEY            # 共用

HEADERS = {"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"}


# ---------- D1 helper ----------
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


# ---------- symbol & user discovery ----------
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


# ---------- helpers ----------
def chunks(lst, size):
    it = iter(lst)
    for first in it:
        yield [first] + list(islice(it, size - 1))


# ---------- core ----------
CHUNK = 40
DL_OPTS = dict(interval="1d", auto_adjust=False, back_adjust=False,
               progress=False, threads=True)


def build_start_map(symbols):
    """Return dict[symbol] -> ISO start_date (never > today)"""
    today = date.today()
    out = {}

    for s in symbols:
        tbl = "exchange_rates" if "=" in s else "price_history"

        latest_res = d1_query(f"SELECT MAX(date) d FROM {tbl} WHERE symbol=?", [s]) or []
        if latest_res and latest_res[0].get("d"):
            start = datetime.strptime(latest_res[0]["d"][:10], "%Y-%m-%d").date() + timedelta(days=1)
        else:
            tx_res = d1_query("SELECT MIN(date) d FROM transactions WHERE symbol=?", [s]) or []
            if tx_res and tx_res[0].get("d"):
                start = datetime.strptime(tx_res[0]["d"][:10], "%Y-%m-%d").date()
            else:
                start = date(2000, 1, 1)

        if start > today:
            start = today
        out[s] = start.isoformat()
    return out


def fetch_and_append_market_data(symbols):
    if not symbols:
        print("⚠  No symbols to update")
        return

    start_map = build_start_map(symbols)
    end_str   = date.today().isoformat()

    for batch in chunks(symbols, CHUNK):
        earliest = min(start_map[s] for s in batch)
        print(f"\n⬇  Downloading {len(batch)} symbols from {earliest} → {end_str}")
        df = yf.download(batch, start=earliest, end
