import os
import yfinance as yf
import requests
import json
from datetime import datetime
import time
import pandas as pd

# =========================================================================================
# == Python 週末完整校驗腳本 (v1.4 - 週末快照觸發版)
# =========================================================================================

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

def get_full_refresh_targets():
    print("正在從 D1 獲取所有需要完整刷新的金融商品列表...")
    sql = "SELECT symbol, earliest_date FROM market_data_coverage"
    targets = d1_query(sql)
    if targets is None:
        return [], []
    
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql)
    uids = [row['uid'] for row in uid_results if row.get('uid')]

    print(f"找到 {len(targets)} 個需完整刷新的標的。")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    return targets, uids

def fetch_and_overwrite_market_data(targets):
    """
    (安全模式) 為每個標的抓取完整歷史數據到預備表，成功後再原子性地覆蓋正式表。
    """
    if not targets:
        print("沒有需要刷新的標的。")
        return

    today_str = datetime.now().strftime('%Y-%m-%d')

    for target in targets:
        symbol = target.get('symbol')
        start_date = target.get('earliest_date')
        
        if not symbol or not start_date:
            continue
            
        print(f"--- [1/3] 開始處理: {symbol} (從 {start_date} 開始) ---")
        
        is_fx = "=" in symbol
        
        # 假設您已為 exchange_rates 建立了 exchange_rates_staging 表
        price_table = "exchange_rates" if is_fx else "price_history"
        price_staging_table = "exchange_rates_staging" if is_fx else "price_history_staging"
        dividend_table = "dividend_history"
        dividend_staging_table = "dividend_history_staging"


        max_retries = 3
        data_fetched_successfully = False
        db_ops_staging = []
        
        for attempt in range(max_retries):
            try:
                stock = yf.Ticker(symbol)
                hist = stock.history(start=start_date, interval="1d", auto_adjust=False, back_adjust=False)
                
                if hist.empty:
                    print(f"警告: 找不到 {symbol} 從 {start_date} 開始的歷史數據。跳過此標的。")
                    break

                print(f"成功抓取到 {len(hist)} 筆 {symbol} 的完整歷史數據。")
                
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
                    print(f"成功將 {len(db_ops_staging)- (1 if is_fx else 2) } 筆新紀錄寫入預備表。")
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
                d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
            else:
                print(f"FATAL: 原子性替換 {symbol} 的數據失敗！請手動檢查資料庫狀態。")
        else:
            print(f"由於資料準備階段失敗，已跳過 {symbol} 的正式表更新。")


def trigger_recalculations(uids):
    """(HTTP 模式) 觸發所有使用者重算，並附帶建立快照的指令"""
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

if __name__ == "__main__":
    print(f"--- 開始執行週末市場數據完整校驗腳本 (v1.4) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    refresh_targets, all_uids = get_full_refresh_targets()
    
    if refresh_targets:
        fetch_and_overwrite_market_data(refresh_targets)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("在 market_data_coverage 表中沒有找到任何需要刷新的標的。")
        
    print("--- 週末市場數據完整校驗腳本執行完畢 ---")
