#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  Python 每日價格更新腳本 (main.py)  v1.2 – 統一 SERVICE_API_KEY + sys 匯入
# =============================================================================
import os
import sys
import json
import time
from datetime import datetime

import requests
import pandas as pd
import yfinance as yf

# ----------------------------------------------------------------------------- 
#  環境變數
# -----------------------------------------------------------------------------
D1_WORKER_URL   = os.environ.get("D1_WORKER_URL")
SERVICE_API_KEY = os.environ.get("SERVICE_API_KEY")        # ★唯一金鑰
GCP_API_URL     = os.environ.get("GCP_API_URL")            # 後端 API 入口

if not SERVICE_API_KEY:
    print("FATAL: Missing SERVICE_API_KEY.")
    sys.exit(1)

# 別名向下相容（可保留也可刪）
D1_API_KEY = SERVICE_API_KEY
GCP_API_KEY = SERVICE_API_KEY

# ----------------------------------------------------------------------------- 
#  D1 Worker 共用函式
# -----------------------------------------------------------------------------
def d1_query(sql, params=None):
    if params is None:
        params = []
    if not D1_WORKER_URL:
        print("FATAL: Missing D1_WORKER_URL.")
        return None
    headers = {"X-API-KEY": SERVICE_API_KEY, "Content-Type": "application/json"}
    try:
        resp = requests.post(f"{D1_WORKER_URL}/query",
                             json={"sql": sql, "params": params},
                             headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.json().get("results", [])
    except requests.RequestException as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return None


def d1_batch(statements):
    if not D1_WORKER_URL:
        print("FATAL: Missing D1_WORKER_URL.")
        return False
    headers = {"X-API-KEY": SERVICE_API_KEY, "Content-Type": "application/json"}
    try:
        resp = requests.post(f"{D1_WORKER_URL}/batch",
                             json={"statements": statements},
                             headers=headers, timeout=60)
        resp.raise_for_status()
        return True
    except requests.RequestException as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False

# ----------------------------------------------------------------------------- 
#  步驟 1：取得今日要更新的標的
# -----------------------------------------------------------------------------
def get_todays_targets():
    sql = ("SELECT DISTINCT symbol FROM holdings "
           "UNION SELECT DISTINCT benchmarkSymbol AS symbol FROM controls")
    rows = d1_query(sql) or []
    return [row["symbol"] for row in rows]

# ----------------------------------------------------------------------------- 
#  步驟 2：抓價格並寫入
# -----------------------------------------------------------------------------
def fetch_and_upsert_prices(symbols):
    if not symbols:
        print("無標的需要更新。")
        return
    today = datetime.utcnow().strftime("%Y-%m-%d")
    for sym in symbols:
        print(f"== 更新 {sym} ==")
        try:
            hist = yf.Ticker(sym).history(period="2d", interval="1d",
                                          auto_adjust=False, back_adjust=False)
            if hist.empty:
                print("警告: 無資料。")
                continue
            latest = hist.iloc[-1]
            price = latest["Close"]
            if pd.isna(price):
                print("警告: 收盤價為 NaN。")
                continue
            stmt = {"sql": ("INSERT OR REPLACE INTO {tbl}"
                            " (symbol,date,price) VALUES (?,?,?)"
                            ).format(tbl="exchange_rates" if "=" in sym
                                                   else "price_history"),
                    "params": [sym, today, float(price)]}
            if d1_batch([stmt]):
                print("寫入成功")
        except Exception as e:
            print(f"ERROR: {e}")

# ----------------------------------------------------------------------------- 
#  步驟 3：觸發全使用者重算
# -----------------------------------------------------------------------------
def trigger_recalculation():
    if not GCP_API_URL:
        print("缺少 GCP_API_URL，跳過重算。")
        return
    headers = {"X-API-KEY": SERVICE_API_KEY, "Content-Type": "application/json"}
    try:
        r = requests.post(GCP_API_URL,
                          json={"action": "recalculate_all_users"},
                          headers=headers, timeout=60)
        if r.ok:
            print("已觸發重算。")
        else:
            print(f"重算失敗: {r.status_code} {r.text}")
    except Exception as e:
        print(f"ERROR: 觸發重算失敗: {e}")

# ----------------------------------------------------------------------------- 
#  主程式
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"=== Daily Price Update start {datetime.utcnow()} ===")
    syms = get_todays_targets()
    fetch_and_upsert_prices(syms)
    trigger_recalculation()
    print("=== Done ===")
