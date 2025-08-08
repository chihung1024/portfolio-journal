#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =========================================================================================
#  ==  Python 週末完整校驗腳本 (main_weekend.py)  v1.1 – 統一 SERVICE_API_KEY + sys 匯入 ==
#  ==  功能：                                                         ==
#  ==    1. 從 D1 market_data_coverage 取所有標的 → yfinance 抓取完整歷史資料              ==
#  ==    2. 覆蓋 price_history / exchange_rates / dividend_history                         ==
#  ==    3. 透過後端 API 觸發「所有使用者」重新計算                                       ==
# =========================================================================================

import os
import sys                         # ← 必須顯式匯入，才能在缺參數時 sys.exit(1)
import json
import time
from datetime import datetime

import requests
import pandas as pd
import yfinance as yf

# -----------------------------------------------------------------------------------------
#  一、環境變數讀取
# -----------------------------------------------------------------------------------------
D1_WORKER_URL   = os.environ.get("D1_WORKER_URL")
SERVICE_API_KEY = os.environ.get("SERVICE_API_KEY")     # 取代 D1_API_KEY / GCP_API_KEY
GCP_API_URL     = os.environ.get("GCP_API_URL")         # 後端 Cloud Function HTTP 入口

if not SERVICE_API_KEY:
    print("FATAL: Missing SERVICE_API_KEY.")
    sys.exit(1)

# 向下相容舊程式碼的別名（如已全面替換，可刪除）
D1_API_KEY = SERVICE_API_KEY
GCP_API_KEY = SERVICE_API_KEY

# -----------------------------------------------------------------------------------------
#  二、與 D1 Worker 互動的共用函式
# -----------------------------------------------------------------------------------------
def d1_query(sql: str, params=None):
    """對 Cloudflare D1 執行單條 SELECT / UPDATE … RETURNING 查詢，返回 list(dict)."""
    if params is None:
        params = []

    if not D1_WORKER_URL:
        print("FATAL: Missing D1_WORKER_URL.")
        return None

    headers = {
        "X-API-KEY": SERVICE_API_KEY,
        "Content-Type": "application/json"
    }

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
    """批次執行多條 INSERT/UPDATE/DELETE。"""
    if not D1_WORKER_URL:
        print("FATAL: Missing D1_WORKER_URL.")
        return False

    headers = {
        "X-API-KEY": SERVICE_API_KEY,
        "Content-Type": "application/json"
    }

    try:
        resp = requests.post(f"{D1_WORKER_URL}/batch",
                             json={"statements": statements},
                             headers=headers, timeout=60)
        resp.raise_for_status()
        return True
    except requests.RequestException as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False


# -----------------------------------------------------------------------------------------
#  三、步驟 1：找出需完整刷新的標的 & 所有活躍使用者
# -----------------------------------------------------------------------------------------
def get_full_refresh_targets():
    sql = "SELECT symbol, earliest_date FROM market_data_coverage"
    targets = d1_query(sql) or []

    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uids = [row["uid"] for row in (d1_query(uid_sql) or [])]

    print(f"找到 {len(targets)} 個標的需完整刷新，{len(uids)} 位使用者需重算。")
    return targets, uids


# -----------------------------------------------------------------------------------------
#  四、步驟 2：抓取與覆蓋市場資料
# -----------------------------------------------------------------------------------------
def fetch_and_overwrite_market_data(targets):
    if not targets:
        print("沒有需要刷新的標的。")
        return

    today_str = datetime.utcnow().strftime("%Y-%m-%d")

    for tgt in targets:
        symbol      = tgt.get("symbol")
        start_date  = tgt.get("earliest_date")
        is_fx       = "=" in symbol
        price_table = "exchange_rates" if is_fx else "price_history"

        print(f"\n---  {symbol}  (自 {start_date} 起完整刷新) ---")

        # 抓資料（最多重試 3 次）
        for attempt in range(3):
            try:
                hist = yf.Ticker(symbol).history(start=start_date,
                                                 interval="1d",
                                                 auto_adjust=False,
                                                 back_adjust=False)
                if hist.empty:
                    print(f"警告: 找不到 {symbol} 歷史資料。")
                    break

                print(f"成功抓取 {len(hist)} 筆資料。")

                # 準備 SQL：先刪舊 → 再插入
                ops = [
                    {"sql": f"DELETE FROM {price_table} WHERE symbol = ?",
                     "params": [symbol]}
                ]
                if not is_fx:
                    ops.append({
                        "sql": "DELETE FROM dividend_history WHERE symbol = ?",
                        "params": [symbol]
                    })

                for idx, row in hist.iterrows():
                    date_str = idx.strftime("%Y-%m-%d")
                    price    = row["Close"]
                    if pd.notna(price):
                        ops.append({
                            "sql": f"INSERT INTO {price_table} (symbol, date, price) "
                                   "VALUES (?,?,?)",
                            "params": [symbol, date_str, float(price)]
                        })
                    if (not is_fx) and row.get("Dividends", 0) > 0:
                        ops.append({
                            "sql": "INSERT INTO dividend_history (symbol, date, dividend) "
                                   "VALUES (?,?,?)",
                            "params": [symbol, date_str, float(row["Dividends"])]
                        })

                if d1_batch(ops):
                    print("✅  覆蓋寫入成功")
                    d1_query("UPDATE market_data_coverage SET last_updated = ? "
                             "WHERE symbol = ?", [today_str, symbol])
                else:
                    print("❌  覆蓋寫入失敗")

                break  # 成功即跳出重試迴圈

            except Exception as e:
                print(f"ERROR (attempt {attempt+1}/3): {e}")
                if attempt < 2:
                    print("5 秒後重試…")
                    time.sleep(5)
                else:
                    print("FATAL: 多次嘗試仍失敗，跳過。")


# -----------------------------------------------------------------------------------------
#  五、步驟 3：觸發所有使用者重算
# -----------------------------------------------------------------------------------------
def trigger_recalculations(uids):
    if not (GCP_API_URL and SERVICE_API_KEY):
        print("警告: 缺少 GCP_API_URL 或 SERVICE_API_KEY，跳過重算觸發。")
        return

    if not uids:
        print("沒有使用者需要重算。")
        return

    print(f"\n---  觸發 {len(uids)} 位使用者重算  ---")

    # 與後端 Cloud Function 約定：action = recalculate_all_users
    headers = {
        "X-API-KEY": SERVICE_API_KEY,
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(GCP_API_URL,
                             json={"action": "recalculate_all_users"},
                             headers=headers, timeout=60)
        if resp.ok:
            print("✅  成功觸發重算")
        else:
            print(f"❌  觸發失敗: {resp.status_code}  {resp.text}")
    except Exception as e:
        print(f"FATAL: 觸發重算時發生錯誤: {e}")


# -----------------------------------------------------------------------------------------
#  六、主程式入口
# -----------------------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"=== 週末市場資料完整校驗腳本啟動 "
          f"({datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}) ===")

    targets, user_ids = get_full_refresh_targets()
    fetch_and_overwrite_market_data(targets)
    trigger_recalculations(user_ids)

    print("=== 腳本執行完畢 ===")
