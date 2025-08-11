import os
import yfinance as yf
import requests
import json
from datetime import datetime, timedelta
import time
import pandas as pd

# =========================================================================================
# == Python 每日增量更新腳本 完整程式碼 (v3.3 - 冪等更新版)
# =========================================================================================

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
# GCP 和 D1 Worker 使用相同的金鑰
GCP_API_KEY = D1_API_KEY

def d1_query(sql, params=None):
    """通用 D1 查詢函式"""
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
    """通用 D1 批次操作函式"""
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": statements}, headers=headers)
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False

def get_update_targets():
    """從 holdings 表獲取所有用戶當前持有的標的"""
    print("正在從 D1 holdings 表獲取所有用戶當前持有的金融商品列表...")
    sql = "SELECT DISTINCT symbol FROM holdings"
    results = d1_query(sql)
    if results is None:
        return [], []
    
    symbols = [row['symbol'] for row in results if row.get('symbol')]
    
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql)
    uids = [row['uid'] for row in uid_results if row.get('uid')]

    print(f"找到 {len(symbols)} 個用戶當前持有的標的: {symbols}")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    return symbols, uids

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
            print(f"警告: 在 {price_table} 中找不到 {symbol} 的任何紀錄，將從 2000-01-01 開始抓取。")
            start_date = "2000-01-01"
        else:
            # 【核心修改】如果最新日期是今天，則 start_date 依然是今天，以便重新抓取
            if latest_date_str == today_str:
                start_date = today_str
                print(f"{symbol} 今日已有數據，準備重新抓取以更新...")
            else:
                start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')

        if start_date > today_str:
            print(f"{symbol} 的數據已是最新 ({latest_date_str})，無需更新。")
            continue

        print(f"準備抓取 {symbol} 從 {start_date} 到今天的增量數據...")

        # 2. 【第二階段】抓取增量數據並寫入「預備表 (Staging Table)」
        max_retries = 3
        data_staged_successfully = False
        hist = pd.DataFrame() # 初始化為空的 DataFrame
        
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
        
        # 3. 【第三階段】如果數據已成功存入預備表，則將其「更新或插入 (UPSERT)」到正式表
        if data_staged_successfully and not hist.empty:
            print(f"--- [3/3] 準備執行 {symbol} 的原子性更新/插入... ---")
            db_ops_upsert = []
            # 【核心修改】使用 UPSERT 語法 (ON CONFLICT DO UPDATE)
            # 這會在新日期時插入數據，在舊日期（僅限今天）時更新價格
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
    """主動觸發所有使用者的投資組合重新計算"""
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
    print(f"--- 開始執行每日市場數據增量更新腳本 (v3.3) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    update_symbols, all_uids = get_update_targets()
    
    if update_symbols:
        fetch_and_append_market_data(update_symbols)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("在 holdings 表中沒有找到任何需要更新的標的。")
        
    print("--- 每日市場數據增量更新腳本執行完畢 ---")
