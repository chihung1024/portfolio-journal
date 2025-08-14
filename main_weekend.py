# =========================================================================================
# == Python 週末完整校驗腳本 (v1.8 - 動態 Benchmark 策略版)
# =========================================================================================
import os
import yfinance as yf
import requests
import json
from datetime import datetime, timedelta
import time
import pandas as pd

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
GCP_API_KEY = D1_API_KEY

def d1_query(sql, params=None):
    if params is None:
        params = []
    if not D1_WORKER_URL or not D1_API_KEY:
        print("FATAL: Missing D1_WORKER_URL or D1_API_KEY environment variables.")
        return None
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers)
        response.raise_for_status()
        return response.json().get('results', [])
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return None

def d1_batch(statements):
    if not D1_WORKER_URL or not D1_API_KEY:
        print("FATAL: Missing D1_WORKER_URL or D1_API_KEY environment variables.")
        return False
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": statements}, headers=headers)
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False

# 【修改點一】讓此函式額外回傳 benchmark_symbols 的集合
def get_full_refresh_targets():
    """
    從三個來源全面獲取需要更新的標的列表，並額外回傳一份所有 Benchmark 的清單。
    """
    print("正在全面獲取所有需要完整刷新的金融商品列表...")
    
    all_symbols = set()
    benchmark_symbols = set()
    currency_to_fx = {"USD": "TWD=X", "HKD": "HKDTWD=X", "JPY": "JPYTWD=X"}

    # 1. 獲取用戶持股並推算匯率
    holdings_sql = "SELECT DISTINCT symbol, currency FROM holdings"
    holdings_results = d1_query(holdings_sql)
    if holdings_results:
        for row in holdings_results:
            all_symbols.add(row['symbol'])
            currency = row.get('currency')
            if currency and currency in currency_to_fx:
                all_symbols.add(currency_to_fx[currency])

    # 2. 獲取所有用戶的 Benchmark，並加入到 all_symbols 和 benchmark_symbols
    benchmark_sql = "SELECT DISTINCT value AS symbol FROM controls WHERE key = 'benchmarkSymbol'"
    benchmark_results = d1_query(benchmark_sql)
    if benchmark_results:
        for row in benchmark_results:
            symbol = row['symbol']
            if symbol:
                all_symbols.add(symbol)
                benchmark_symbols.add(symbol)

    targets = list(all_symbols)
    
    # 3. 獲取所有活躍的使用者 ID
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql)
    uids = [row['uid'] for row in uid_results if row.get('uid')] if uid_results else []

    print(f"找到 {len(targets)} 個需全面刷新的標的: {targets}")
    print(f"從資料庫找到 {len(benchmark_symbols)} 個 Benchmark: {benchmark_symbols}")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    
    return targets, benchmark_symbols, uids

# 【修改點二】讓此函式接收 benchmark_symbols 集合
def fetch_and_overwrite_market_data(targets, benchmark_symbols):
    """
    (安全模式) 為每個標的抓取完整歷史數據，並根據其是否為 Benchmark 決定抓取策略。
    """
    if not targets:
        print("沒有需要刷新的標的。")
        return

    today_str = datetime.now().strftime('%Y-%m-%d')

    for symbol in targets:
        if not symbol: continue

        is_fx = "=" in symbol
        # 檢查此 symbol 是否為從資料庫中查到的 Benchmark 之一
        is_benchmark = symbol in benchmark_symbols

        if is_fx or is_benchmark:
            # 策略 A: 對於匯率和 Benchmark，我們總是希望有長期的歷史數據
            # 優先從 market_data_coverage 表中尋找已記錄的最早日期
            start_date_from_db = d1_query("SELECT earliest_date FROM market_data_coverage WHERE symbol = ?", [symbol])
            if start_date_from_db and start_date_from_db[0].get('earliest_date'):
                 start_date = start_date_from_db[0]['earliest_date'].split('T')[0]
                 print(f"資訊: {symbol} 是特殊標的，將從已記錄的最早日期 {start_date} 開始抓取。")
            else:
                 # 如果連 coverage 表都沒有，給一個非常早的預設值
                 start_date = "2000-01-01" 
                 print(f"資訊: {symbol} 是特殊標的，且無歷史記錄，將從預設值 {start_date} 開始抓取。")
        else:
            # 策略 B: 對於普通持股，維持原有邏輯，從首次交易日開始
            start_date_result = d1_query("SELECT MIN(date) as earliest_date FROM transactions WHERE symbol = ?", [symbol])
            if start_date_result and start_date_result[0].get('earliest_date'):
                start_date = start_date_result[0]['earliest_date'].split('T')[0]
            else:
                # 如果普通持股也找不到交易日（不太可能發生），也給一個預設值
                start_date = "2000-01-01"

        print(f"--- [1/3] 開始處理: {symbol} (從 {start_date} 開始) ---")
        
        price_table = "exchange_rates" if is_fx else "price_history"
        price_staging_table = "exchange_rates_staging" if is_fx else "price_history_staging"
        dividend_table = "dividend_history"
        dividend_staging_table = "dividend_history_staging"

        max_retries = 3
        data_fetched_successfully = False
        
        for attempt in range(max_retries):
            try:
                stock = yf.Ticker(symbol)
                hist = stock.history(start=start_date, interval="1d", auto_adjust=False, back_adjust=False)
                
                if hist.empty:
                    print(f"警告: 找不到 {symbol} 從 {start_date} 開始的歷史數據。跳過此標的。")
                    break

                print(f"成功抓取到 {len(hist)} 筆 {symbol} 的完整歷史數據。")
                
                db_ops_staging = []
                db_ops_staging.append({"sql": f"DELETE FROM {price_staging_table} WHERE symbol = ?", "params": [symbol]})
                if not is_fx:
                    db_ops_staging.append({"sql": f"DELETE FROM {dividend_staging_table} WHERE symbol = ?", "params": [symbol]})

                for idx, row in hist.iterrows():
                    date_str = idx.strftime('%Y-%m-%d')
                    if pd.notna(row['Close']):
                        db_ops_staging.append({
                            "sql": f"INSERT INTO {price_staging_table} (symbol, date, price) VALUES (?, ?, ?)",
                            "params": [symbol, date_str, row['Close']]
                        })
                    if not is_fx and row.get('Dividends', 0) > 0:
                        db_ops_staging.append({
                            "sql": f"INSERT INTO {dividend_staging_table} (symbol, date, dividend) VALUES (?, ?, ?)",
                            "params": [symbol, date_str, row['Dividends']]
                        })
                
                print(f"--- [2/3] 正在將新數據寫入 {symbol} 的預備表... ---")
                if d1_batch(db_ops_staging):
                    print(f"成功將 {len(hist)} 筆新紀錄寫入預備表。")
                    data_fetched_successfully = True
                else:
                    raise Exception(f"寫入 {symbol} 的數據到預備表失敗。")
                
                break 

            except Exception as e:
                print(f"ERROR on attempt {attempt + 1} for {symbol}: {e}")
                if attempt < max_retries - 1:
                    print("5 秒後重試...")
                    time.sleep(5)
                else:
                    print(f"FATAL: 連續 {max_retries} 次處理 {symbol} 失敗。正式表資料未受影響。")

        if data_fetched_successfully:
            print(f"--- [3/3] 準備執行 {symbol} 的原子性資料替換... ---")
            db_ops_swap = []
            db_ops_swap.append({"sql": f"DELETE FROM {price_table} WHERE symbol = ?", "params": [symbol]})
            db_ops_swap.append({"sql": f"INSERT INTO {price_table} (symbol, date, price) SELECT symbol, date, price FROM {price_staging_table} WHERE symbol = ?", "params": [symbol]})
            
            if not is_fx:
                db_ops_swap.append({"sql": f"DELETE FROM {dividend_table} WHERE symbol = ?", "params": [symbol]})
                db_ops_swap.append({"sql": f"INSERT INTO {dividend_table} (symbol, date, dividend) SELECT symbol, date, dividend FROM {dividend_staging_table} WHERE symbol = ?", "params": [symbol]})

            if d1_batch(db_ops_swap):
                print(f"成功！ {symbol} 的正式表數據已原子性更新。")
                # 更新覆蓋範圍紀錄
                earliest_date_in_hist = hist.index.min().strftime('%Y-%m-%d')
                
                # 檢查 coverage 表中是否已存在該 symbol 的紀錄
                coverage_exists = d1_query("SELECT 1 FROM market_data_coverage WHERE symbol = ?", [symbol])
                if coverage_exists:
                    d1_query("UPDATE market_data_coverage SET earliest_date = ?, last_updated = ? WHERE symbol = ?", [earliest_date_in_hist, today_str, symbol])
                else:
                    d1_query("INSERT INTO market_data_coverage (symbol, earliest_date, last_updated) VALUES (?, ?, ?)", [symbol, earliest_date_in_hist, today_str])
            else:
                print(f"FATAL: 原子性替換 {symbol} 的數據失敗！請手動檢查資料庫狀態。")
        else:
            print(f"由於資料準備階段失敗，已跳過 {symbol} 的正式表更新。")

def trigger_recalculations(uids):
    if not uids:
        print("沒有找到需要觸發重算的使用者。")
        return
    if not GCP_API_URL or not GCP_API_KEY:
        print("警告: 缺少 GCP_API_URL 或 GCP_API_KEY，跳過觸發重算。")
        return
    print(f"\n--- 準備為 {len(uids)} 位使用者觸發重算 (包含建立快照指令) ---")
    SERVICE_ACCOUNT_KEY = os.environ.get("SERVICE_ACCOUNT_KEY")
    if not SERVICE_ACCOUNT_KEY:
        print("FATAL: 缺少 SERVICE_ACCOUNT_KEY 環境變數，無法觸發重算。")
        return
    headers = {
        'X-API-KEY': GCP_API_KEY, 
        'Content-Type': 'application/json',
        'X-Service-Account-Key': SERVICE_ACCOUNT_KEY
    }
    try:
        payload = {
            "action": "recalculate_all_users",
            "createSnapshot": True 
        }
        response = requests.post(GCP_API_URL, json=payload, headers=headers)
        if response.status_code == 200:
            print(f"成功觸發所有使用者的重算與快照建立。")
        else:
            print(f"觸發重算失敗. 狀態碼: {response.status_code}, 回應: {response.text}")
    except Exception as e:
        print(f"觸發重算時發生錯誤: {e}")

# 【修改點三】更新主執行區塊的函式呼叫
if __name__ == "__main__":
    print(f"--- 開始執行週末市場數據完整校驗腳本 (v1.8) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    # 現在 get_full_refresh_targets 會回傳三個值
    refresh_targets, benchmarks, all_uids = get_full_refresh_targets()
    if refresh_targets:
        # 將 benchmarks 傳遞給 fetch_and_overwrite_market_data
        fetch_and_overwrite_market_data(refresh_targets, benchmarks)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("資料庫中沒有找到任何需要刷新的標的 (無持股、無Benchmark)。")
    print("--- 週末市場數據完整校驗腳本執行完畢 ---")
