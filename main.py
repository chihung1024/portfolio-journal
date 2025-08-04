import os
import yfinance as yf
import requests
import json
from datetime import datetime, timedelta
import time
import pandas as pd

# =========================================================================================
# == Python 每日更新腳本 完整程式碼 (v2.2 - 精確範圍更新版)
# =========================================================================================

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
GCP_API_KEY = D1_API_KEY 


# [# 修改] 函式重構：不僅獲取標的，還獲取每個標的的最早交易日期
def get_symbol_date_ranges_from_d1():
    """
    從 D1 讀取所有活躍使用者的標的，並找出每個標的的最早交易日期。
    返回一個包含標的及其所需起始日期的字典，以及一個使用者列表。
    """
    if not D1_WORKER_URL or not D1_API_KEY:
        print("FATAL: Missing D1_WORKER_URL or D1_API_KEY environment variables.")
        return {}, []

    symbol_ranges = {}
    all_uids = set()
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}

    try:
        # 1. 一次性獲取所有使用者的 UID
        uid_query_sql = "SELECT DISTINCT uid FROM transactions"
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": uid_query_sql}, headers=headers)
        response.raise_for_status()
        for row in response.json().get('results', []):
            if row.get('uid'):
                all_uids.add(row['uid'])
        print(f"Found {len(all_uids)} unique users with transactions.")

        # 2. 一次性獲取所有交易標的及其最早交易日期
        tx_symbols_sql = "SELECT symbol, MIN(date) as first_date FROM transactions GROUP BY symbol"
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": tx_symbols_sql}, headers=headers)
        response.raise_for_status()
        for row in response.json().get('results', []):
            if row.get('symbol') and row.get('first_date'):
                symbol_ranges[row['symbol'].upper()] = row['first_date']

        # 3. 獲取所有 benchmark 標的
        benchmark_symbols_sql = "SELECT DISTINCT value as symbol FROM controls WHERE key = 'benchmarkSymbol'"
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": benchmark_symbols_sql}, headers=headers)
        response.raise_for_status()
        
        # 4. 為 benchmark 標的設定更新範圍（以所有交易的最早日期為準）
        if response.json().get('results', []):
            first_tx_date_ever_sql = "SELECT MIN(date) as min_date FROM transactions"
            res = requests.post(f"{D1_WORKER_URL}/query", json={"sql": first_tx_date_ever_sql}, headers=headers)
            res.raise_for_status()
            first_date_ever = res.json().get('results', [{}])[0].get('min_date')

            if first_date_ever:
                for row in response.json().get('results', []):
                    symbol = row.get('symbol', '').upper()
                    if symbol and symbol not in symbol_ranges:
                        symbol_ranges[symbol] = first_date_ever
        
        print(f"Found {len(symbol_ranges)} unique symbols to update.")
        return symbol_ranges, list(all_uids)

    except requests.exceptions.RequestException as e:
        print(f"FATAL: A network error occurred while communicating with D1 Worker: {e}")
        return {}, []
    except Exception as e:
        print(f"FATAL: An unexpected error occurred in get_symbol_date_ranges_from_d1: {e}")
        return {}, []


# [# 修改] 函式升級：接受包含日期的字典作為參數
def fetch_and_update_market_data(symbol_date_ranges):
    """
    根據提供的標的及其最早交易日期，從 yfinance 抓取數據並寫回 D1。
    """
    if not symbol_date_ranges:
        print("No symbols to update.")
        return

    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    # 確保匯率數據也被更新
    all_symbols_to_update = set(list(symbol_date_ranges.keys()) + ["TWD=X"])
    
    # 為匯率設定一個預設的起始日期（以所有交易的最早日期為準）
    if "TWD=X" not in symbol_date_ranges:
        first_date_ever = min(symbol_date_ranges.values()) if symbol_date_ranges else datetime.now().strftime('%Y-%m-%d')
        symbol_date_ranges["TWD=X"] = first_date_ever

    for symbol in all_symbols_to_update:
        if not symbol: continue
        print(f"--- Processing: {symbol} ---")

        # [# 修改] 動態計算抓取範圍
        first_tx_date_str = symbol_date_ranges[symbol]
        first_tx_date = datetime.strptime(first_tx_date_str, '%Y-%m-%d')
        # 從最早交易日期往前推 31 天作為緩衝
        start_date = first_tx_date - timedelta(days=31)
        end_date = datetime.now()

        max_retries = 3
        for attempt in range(max_retries):
            try:
                stock = yf.Ticker(symbol)
                # [# 修改] 使用 start 和 end 參數來限定日期範圍
                hist = stock.history(
                    start=start_date.strftime('%Y-%m-%d'), 
                    end=end_date.strftime('%Y-%m-%d'),
                    interval="1d", 
                    auto_adjust=False, 
                    back_adjust=False
                )
                
                if hist.empty:
                    print(f"Warning: No history found for {symbol} in the specified range.")
                    break 
                
                print(f"Fetched {len(hist)} records for {symbol} from {start_date.strftime('%Y-%m-%d')} to today.")
                
                prices = {idx.strftime('%Y-%m-%d'): val for idx, val in hist['Close'].items() if pd.notna(val)}
                dividends = {idx.strftime('%Y-%m-%d'): val for idx, val in hist['Dividends'].items() if val > 0}

                db_ops = []
                price_table = "exchange_rates" if "=" in symbol else "price_history"
                
                # [# 修改] 只刪除我們即將更新的範圍內的數據，而不是全部刪除
                db_ops.append({
                    "sql": f"DELETE FROM {price_table} WHERE symbol = ? AND date >= ?", 
                    "params": [symbol, start_date.strftime('%Y-%m-%d')]
                })
                if not "=" in symbol:
                    db_ops.append({
                        "sql": "DELETE FROM dividend_history WHERE symbol = ? AND date >= ?",
                        "params": [symbol, start_date.strftime('%Y-%m-%d')]
                    })

                # 使用 INSERT OR IGNORE 避免因主鍵衝突而失敗
                for date, price in prices.items():
                    db_ops.append({
                        "sql": f"INSERT OR IGNORE INTO {price_table} (symbol, date, price) VALUES (?, ?, ?)",
                        "params": [symbol, date, price]
                    })
                for date, dividend in dividends.items():
                    db_ops.append({
                        "sql": "INSERT OR IGNORE INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)",
                        "params": [symbol, date, dividend]
                    })

                response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": db_ops}, headers=headers)
                response.raise_for_status()
                
                print(f"Successfully updated data for {symbol} in D1.")
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
    # ... 此函式無需修改，保持原樣 ...
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
            # 注意：觸發重新計算時，我們不傳遞 token，因為這是受信任的後端腳本
            # Cloud Function 中的 API 金鑰驗證會通過
            response = requests.post(GCP_API_URL, json=payload, headers=headers)
            if response.status_code == 200:
                print(f"Successfully triggered recalculation for uid: {uid}")
            else:
                print(f"Failed to trigger recalculation for uid: {uid}. Status: {response.status_code}, Response: {response.text}")
        except Exception as e:
            print(f"An error occurred while triggering recalculation for uid: {uid}. Error: {e}")
        time.sleep(1) # 避免請求過於頻繁


if __name__ == "__main__":
    print("Starting daily market data update script (v2.2)...")
    # [# 修改] 呼叫新的函式
    symbol_ranges, uids = get_symbol_date_ranges_from_d1()
    
    if symbol_ranges:
        # [# 修改] 傳遞新的資料結構
        fetch_and_update_market_data(symbol_ranges)
        # 觸發重新計算的邏輯不變
        trigger_recalculations(uids)
    else:
        print("No symbols found to update.")
        
    print("Daily market data update script finished.")
