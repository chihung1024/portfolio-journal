import os
import yfinance as yf
import requests
import json
from datetime import datetime
import time
import pandas as pd # <--- [修正] 加入這一行

# =========================================================================================
# == Python 每日更新腳本 完整程式碼 (v2.1 - 修正版)
# =========================================================================================

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
GCP_API_KEY = D1_API_KEY 


def get_all_symbols_and_users_from_d1():
    """透過 D1 Worker API 從 D1 讀取所有獨立的使用者ID和股票代碼"""
    if not D1_WORKER_URL or not D1_API_KEY:
        print("FATAL: Missing D1_WORKER_URL or D1_API_KEY environment variables.")
        return [], []

    all_symbols = set()
    all_uids = set()
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}

    try:
        # 1. 獲取所有活躍的使用者 ID
        uid_query_sql = "SELECT DISTINCT uid FROM transactions"
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": uid_query_sql}, headers=headers)
        response.raise_for_status()
        uids_data = response.json().get('results', [])
        for row in uids_data:
            if row.get('uid'):
                all_uids.add(row['uid'])
        print(f"Found {len(all_uids)} unique users with transactions.")

        # 2. 根據使用者 ID 獲取他們的股票代碼和 benchmark
        for uid in all_uids:
            queries = [
                f"SELECT DISTINCT symbol FROM transactions WHERE uid = '{uid}'",
                f"SELECT value FROM controls WHERE key = 'benchmarkSymbol' AND uid = '{uid}'"
            ]
            for sql in queries:
                res = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql}, headers=headers)
                res.raise_for_status()
                symbol_data = res.json().get('results', [])
                for row in symbol_data:
                    symbol = row.get('symbol') or row.get('value')
                    if symbol:
                        all_symbols.add(symbol.upper())
        
        final_symbols = list(filter(None, all_symbols))
        print(f"Found {len(final_symbols)} unique symbols to update: {final_symbols}")
        return final_symbols, list(all_uids)

    except requests.exceptions.RequestException as e:
        print(f"FATAL: A network error occurred while communicating with D1 Worker: {e}")
        return [], []
    except Exception as e:
        print(f"FATAL: An unexpected error occurred in get_all_symbols_and_users_from_d1: {e}")
        return [], []


def fetch_and_update_market_data(symbols):
    """使用 yfinance 抓取數據，並透過 D1 Worker API 寫回 D1"""
    if not symbols:
        print("No symbols to update.")
        return

    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    all_symbols_to_update = list(set(symbols + ["TWD=X"]))

    for symbol in all_symbols_to_update:
        if not symbol: continue
        print(f"--- Processing: {symbol} ---")
        max_retries = 3
        for attempt in range(max_retries):
            try:
                stock = yf.Ticker(symbol)
                hist = stock.history(period="max", interval="1d", auto_adjust=False, back_adjust=False)
                
                if hist.empty:
                    print(f"Warning: No history found for {symbol}.")
                    break 

                print(f"Successfully fetched data for {symbol} on attempt {attempt + 1}.")
                
                prices = {idx.strftime('%Y-%m-%d'): val for idx, val in hist['Close'].items() if pd.notna(val)}
                dividends = {idx.strftime('%Y-%m-%d'): val for idx, val in hist['Dividends'].items() if val > 0}

                # 準備 SQL 指令
                db_ops = []
                price_table = "exchange_rates" if "=" in symbol else "price_history"
                
                db_ops.append({"sql": f"DELETE FROM {price_table} WHERE symbol = ?", "params": [symbol]})
                if not "=" in symbol:
                    db_ops.append({"sql": "DELETE FROM dividend_history WHERE symbol = ?", "params": [symbol]})

                for date, price in prices.items():
                    db_ops.append({
                        "sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?)",
                        "params": [symbol, date, price]
                    })

                for date, dividend in dividends.items():
                    db_ops.append({
                        "sql": "INSERT INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)",
                        "params": [symbol, date, dividend]
                    })

                # 透過 API 一次性批次寫入
                response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": db_ops}, headers=headers)
                response.raise_for_status()
                
                print(f"Successfully wrote {len(prices)} prices and {len(dividends)} dividends for {symbol} to D1.")
                break 

            except Exception as e:
                print(f"ERROR on attempt {attempt + 1} for {symbol}: {e}")
                if attempt < max_retries - 1:
                    print("Retrying in 5 seconds...")
                    time.sleep(5)
                else:
                    print(f"FATAL: Failed to process data for {symbol} after {max_retries} attempts.")


def trigger_recalculations(uids):
    """主動觸發所有使用者的投資組合重新計算"""
    if not uids:
        print("No users found to trigger recalculation.")
        return
    if not GCP_API_URL or not GCP_API_KEY:
        print("WARNING: Missing GCP_API_URL or GCP_API_KEY, skipping recalculation trigger.")
        return

    print(f"\n--- Triggering recalculation for {len(uids)} users ---")
    headers = {'X-API-KEY': GCP_API_KEY, 'Content-Type': 'application/json'}
    
    for uid in uids:
        try:
            payload = {"action": "recalculate", "uid": uid}
            response = requests.post(GCP_API_URL, json=payload, headers=headers)
            if response.status_code == 200:
                print(f"Successfully triggered recalculation for uid: {uid}")
            else:
                print(f"Failed to trigger recalculation for uid: {uid}. Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            print(f"An error occurred while triggering recalculation for uid: {uid}. Error: {e}")
        time.sleep(1) # 避免請求過於頻繁


if __name__ == "__main__":
    print("Starting daily market data update script (v2.1)...")
    symbols, uids = get_all_symbols_and_users_from_d1()
    
    if symbols:
        fetch_and_update_market_data(symbols)
        trigger_recalculations(uids)
    else:
        print("No symbols found to update.")
        
    print("Daily market data update script finished.")
