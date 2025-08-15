import os
import yfinance as yf
import requests
import json
from datetime import datetime, timedelta
import time
import pandas as pd

# =========================================================================================
# == Python 每日增量更新腳本 完整程式碼 (v3.4 - 全面更新版)
# =========================================================================================

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
GCP_API_KEY = D1_API_KEY

def d1_query(sql, params=None):
    if params is None:
        params = []
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers)
        response.raise_for_status()
        return response.json().get('results', [])
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return None

def d1_batch(statements):
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
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

# ... fetch_and_append_market_data 和 trigger_recalculations 函式維持 v3.3 版的內容不變 ...
def fetch_and_append_market_data(symbols):
    """
    採用三階段安全模式，為每個標的抓取增量數據，並附加到 D1 資料庫。
    此版本支援冪等性，可重複執行以更新當日數據。
    """
    if not symbols:
        print("沒有需要更新的標的。")
        return

    today_str = datetime.now().strftime('%Y-%m-%d')

    for symbol in symbols:
        if not symbol: continue
            
        print(f"--- [1/3] 開始處理增量更新: {symbol} ---")
        
        is_fx = "=" in symbol
        price_table = "exchange_rates" if is_fx else "price_history"
        price_staging_table = "exchange_rates_staging" if is_fx else "price_history_staging"
        dividend_table = "dividend_history"
        dividend_staging_table = "dividend_history_staging"
        
        latest_date_sql = f"SELECT MAX(date) as latest_date FROM {price_table} WHERE symbol = ?"
        result = d1_query(latest_date_sql, [symbol])
        
        latest_date_str = None
        if result and result[0].get('latest_date'):
            latest_date_str = result[0]['latest_date'].split('T')[0]
        
        if not latest_date_str:
            # 如果價格歷史中沒有紀錄，則查詢交易紀錄中的最早日期
            print(f"資訊: 在 {price_table} 中找不到 {symbol} 的任何紀錄，正在查詢首次交易日期...")
            first_tx_sql = "SELECT MIN(date) as first_tx_date FROM transactions WHERE symbol = ?"
            tx_result = d1_query(first_tx_sql, [symbol])
            
            if tx_result and tx_result[0].get('first_tx_date'):
                start_date = tx_result[0]['first_tx_date'].split('T')[0]
                print(f"找到 {symbol} 的首次交易日期: {start_date}，將從此日期開始抓取。")
            else:
                # 如果連交易紀錄都沒有（例如純 Benchmark），則使用終極預設值
                start_date = "2000-01-01"
                print(f"警告: 在 transactions 中也找不到 {symbol} 的紀錄，將從 {start_date} 開始抓取。")
        else:
            # 維持原有的增量更新邏輯
            if latest_date_str == today_str:
                start_date = today_str
                print(f"{symbol} 今日已有數據，準備重新抓取以更新...")
            else:
                start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')

        if start_date > today_str:
            print(f"{symbol} 的數據已是最新 ({latest_date_str})，無需更新。")
            d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
            continue

        print(f"準備抓取 {symbol} 從 {start_date} 到今天的增量數據...")

        max_retries = 3
        data_staged_successfully = False
        hist = pd.DataFrame()
        
        for attempt in range(max_retries):
            try:
                stock = yf.Ticker(symbol)
                end_date_fetch = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
                hist = stock.history(start=start_date, end=end_date_fetch, interval="1d", auto_adjust=False, back_adjust=False)
                
                if hist.empty:
                    print(f"在 {start_date} 之後沒有找到 {symbol} 的新數據。")
                    d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
                    data_staged_successfully = True
                    break

                print(f"成功抓取到 {len(hist)} 筆 {symbol} 的新數據。")
                
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
                    data_staged_successfully = True
                else:
                    raise Exception(f"寫入 {symbol} 的數據到預備表失敗。")
                
                break 

            except Exception as e:
                print(f"ERROR on attempt {attempt + 1} for {symbol}: {e}")
                if attempt < max_retries - 1:
                    print("5 秒後重試...")
                    time.sleep(5)
                else:
                    print(f"FATAL: 連續 {max_retries} 次處理 {symbol} 失敗。預備表資料未寫入。")
        
        if data_staged_successfully and not hist.empty:
            print(f"--- [3/3] 準備執行 {symbol} 的原子性更新/插入... ---")
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
                print(f"成功！ {symbol} 的增量數據已安全地更新或寫入正式表。")
                d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
            else:
                print(f"FATAL: 更新/插入 {symbol} 的數據失敗！請手動檢查資料庫狀態。")
        elif not data_staged_successfully:
            print(f"由於資料準備階段失敗，已跳過 {symbol} 的正式表更新。")

def trigger_recalculations(uids):
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
    print(f"--- 開始執行每日市場數據增量更新腳本 (v3.4) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    update_symbols, all_uids = get_update_targets()
    if update_symbols:
        fetch_and_append_market_data(update_symbols)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("資料庫中沒有找到任何需要更新的標的 (無持股、無Benchmark)。")
    print("--- 每日市場數據增量更新腳本執行完畢 ---")
