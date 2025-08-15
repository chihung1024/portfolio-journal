import os
import yfinance as yf
import requests
import json
from datetime import datetime, timedelta
import time
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# =========================================================================================
# == Python 每日增量更新腳本 完整程式碼 (v3.5 - 多工優化版)
# =========================================================================================

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
GCP_API_KEY = D1_API_KEY

# 添加執行緒鎖以保護資料庫操作
db_lock = threading.Lock()

def d1_query(sql, params=None):
    if params is None:
        params = []
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        with db_lock:  # 保護資料庫查詢
            response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers)
            response.raise_for_status()
            return response.json().get('results', [])
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return None

def d1_batch(statements):
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        with db_lock:  # 保護批次操作
            response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": statements}, headers=headers)
            response.raise_for_status()
            return True
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False

def get_update_targets():
    """
    【核心修改】從三個來源全面獲取需要更新的標的列表：
    1. 當前用戶持股
    2. 所有用戶設定的 Benchmark
    3. 根據持股幣別推算出的必要匯率
    """
    print("正在全面獲取所有需要更新的金融商品列表...")
    
    all_symbols = set()
    currency_to_fx = {"USD": "TWD=X", "HKD": "HKDTWD=X", "JPY": "JPYTWD=X"}

    # 1. 獲取用戶持股
    holdings_sql = "SELECT DISTINCT symbol, currency FROM holdings"
    holdings_results = d1_query(holdings_sql)
    if holdings_results:
        for row in holdings_results:
            all_symbols.add(row['symbol'])
            # 2. 根據持股幣別推算匯率
            currency = row.get('currency')
            if currency and currency in currency_to_fx:
                all_symbols.add(currency_to_fx[currency])

    # 3. 獲取所有用戶的 Benchmark
    benchmark_sql = "SELECT DISTINCT value AS symbol FROM controls WHERE key = 'benchmarkSymbol'"
    benchmark_results = d1_query(benchmark_sql)
    if benchmark_results:
        for row in benchmark_results:
            all_symbols.add(row['symbol'])
    
    symbols_list = list(all_symbols)
    
    # 獲取所有活躍的使用者 ID
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql)
    uids = [row['uid'] for row in uid_results if row.get('uid')] if uid_results else []

    print(f"找到 {len(symbols_list)} 個需全面更新的標的: {symbols_list}")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    return symbols_list, uids

def fetch_data_for_single_symbol(symbol, start_date):
    """
    單一標的的數據抓取函式 - 專為多工優化設計
    """
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            stock = yf.Ticker(symbol)
            end_date_fetch = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
            hist = stock.history(start=start_date, end=end_date_fetch, interval="1d", auto_adjust=False, back_adjust=False)
            
            if hist.empty:
                return symbol, None, "無新數據"
            
            print(f"✓ 成功抓取 {symbol}: {len(hist)} 筆數據 (執行緒: {threading.current_thread().name})")
            return symbol, hist, None
            
        except Exception as e:
            print(f"✗ {symbol} 嘗試 {attempt + 1}/{max_retries} 失敗: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # 指數退避
    
    return symbol, None, f"連續 {max_retries} 次失敗"

def get_symbol_start_date(symbol):
    """
    獲取單一標的的起始抓取日期
    """
    today_str = datetime.now().strftime('%Y-%m-%d')
    is_fx = "=" in symbol
    price_table = "exchange_rates" if is_fx else "price_history"
    
    latest_date_sql = f"SELECT MAX(date) as latest_date FROM {price_table} WHERE symbol = ?"
    result = d1_query(latest_date_sql, [symbol])
    
    latest_date_str = None
    if result and result[0].get('latest_date'):
        latest_date_str = result['latest_date'].split('T')
    
    if not latest_date_str:
        first_tx_sql = "SELECT MIN(date) as first_tx_date FROM transactions WHERE symbol = ?"
        tx_result = d1_query(first_tx_sql, [symbol])
        
        if tx_result and tx_result.get('first_tx_date'):
            start_date = tx_result['first_tx_date'].split('T')
            print(f"找到 {symbol} 的首次交易日期: {start_date}")
        else:
            start_date = "2000-01-01"
            print(f"使用預設起始日期 {start_date} for {symbol}")
    else:
        if latest_date_str == today_str:
            start_date = today_str
            print(f"{symbol} 今日已有數據，準備重新抓取以更新...")
        else:
            start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
    
    if start_date > today_str:
        return None  # 標示無需更新
    
    return start_date

def process_symbol_data(symbol, hist_data):
    """
    處理並寫入單一標的的數據到資料庫
    """
    if hist_data is None:
        return f"{symbol}: 無數據需要處理"
    
    today_str = datetime.now().strftime('%Y-%m-%d')
    is_fx = "=" in symbol
    price_table = "exchange_rates" if is_fx else "price_history"
    price_staging_table = "exchange_rates_staging" if is_fx else "price_history_staging"
    dividend_staging_table = "dividend_history_staging"
    
    try:
        # 準備數據庫操作
        db_ops_staging = []
        db_ops_staging.append({"sql": f"DELETE FROM {price_staging_table} WHERE symbol = ?", "params": [symbol]})
        if not is_fx:
            db_ops_staging.append({"sql": f"DELETE FROM {dividend_staging_table} WHERE symbol = ?", "params": [symbol]})

        for idx, row in hist_data.iterrows():
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
        
        # 寫入預備表
        if not d1_batch(db_ops_staging):
            return f"{symbol}: 寫入預備表失敗"
        
        # 執行原子性更新
        db_ops_upsert = []
        price_upsert_sql = f"""
            INSERT INTO {price_table} (symbol, date, price)
            SELECT symbol, date, price FROM {price_staging_table} WHERE symbol = ?
            ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;
        """
        db_ops_upsert.append({"sql": price_upsert_sql, "params": [symbol]})
        
        if not is_fx:
            dividend_upsert_sql = f"""
                INSERT INTO dividend_history (symbol, date, dividend)
                SELECT symbol, date, dividend FROM {dividend_staging_table} WHERE symbol = ?
                ON CONFLICT(symbol, date) DO UPDATE SET dividend = excluded.dividend;
            """
            db_ops_upsert.append({"sql": dividend_upsert_sql, "params": [symbol]})

        if d1_batch(db_ops_upsert):
            d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
            return f"{symbol}: ✓ 成功更新 {len(hist_data)} 筆記錄"
        else:
            return f"{symbol}: ✗ 更新正式表失敗"
            
    except Exception as e:
        return f"{symbol}: ✗ 處理時發生錯誤: {e}"

def fetch_and_append_market_data_parallel(symbols, max_workers=5):
    """
    【重大優化】採用多工並行抓取與處理市場數據
    """
    if not symbols:
        print("沒有需要更新的標的。")
        return

    print(f"=== 開始多工並行處理 {len(symbols)} 個標的 (最大工作者數: {max_workers}) ===")
    
    # 第一階段：並行抓取所有標的的起始日期
    symbol_start_dates = {}
    for symbol in symbols:
        start_date = get_symbol_start_date(symbol)
        if start_date:
            symbol_start_dates[symbol] = start_date
        else:
            print(f"{symbol}: 數據已是最新，跳過")
    
    if not symbol_start_dates:
        print("所有標的數據皆為最新，無需更新。")
        return
    
    print(f"需要更新的標的數量: {len(symbol_start_dates)}")
    
    # 第二階段：並行抓取市場數據
    print("\n--- 階段 1: 並行抓取市場數據 ---")
    fetch_results = {}
    
    with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="DataFetcher") as executor:
        # 提交所有抓取任務
        future_to_symbol = {
            executor.submit(fetch_data_for_single_symbol, symbol, start_date): symbol 
            for symbol, start_date in symbol_start_dates.items()
        }
        
        # 收集結果
        for future in as_completed(future_to_symbol):
            symbol, hist_data, error = future.result()
            if error:
                print(f"✗ {symbol}: {error}")
            else:
                fetch_results[symbol] = hist_data
    
    print(f"數據抓取完成: 成功 {len(fetch_results)}/{len(symbol_start_dates)} 個標的")
    
    # 第三階段：序列化處理資料庫寫入 (避免資料庫衝突)
    print("\n--- 階段 2: 序列化資料庫更新 ---")
    for symbol, hist_data in fetch_results.items():
        result = process_symbol_data(symbol, hist_data)
        print(result)
    
    print("=== 多工並行處理完成 ===")

def trigger_recalculations(uids):
    """
    觸發重新計算 - 維持原有實作
    """
    if not uids:
        print("沒有找到需要觸發重算的使用者。")
        return
    if not GCP_API_URL or not GCP_API_KEY:
        print("警告: 缺少 GCP_API_URL 或 GCP_API_KEY，跳過觸發重算。")
        return
    
    print(f"\n--- 準備為 {len(uids)} 位使用者觸發重算 ---")
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
        payload = {"action": "recalculate_all_users"}
        response = requests.post(GCP_API_URL, json=payload, headers=headers)
        if response.status_code == 200:
            print(f"成功觸發所有使用者的重算。")
        else:
            print(f"觸發全部重算失敗. 狀態碼: {response.status_code}, 回應: {response.text}")
    except Exception as e:
        print(f"觸發全部重算時發生錯誤: {e}")

if __name__ == "__main__":
    print(f"--- 開始執行每日市場數據增量更新腳本 (v3.5 多工優化版) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    update_symbols, all_uids = get_update_targets()
    
    if update_symbols:
        # 使用優化後的多工函式，可調整 max_workers 參數
        fetch_and_append_market_data_parallel(update_symbols, max_workers=5)
        
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("資料庫中沒有找到任何需要更新的標的 (無持股、無Benchmark)。")
    
    print("--- 每日市場數據增量更新腳本執行完畢 ---")
