import os
import yfinance as yf
import requests
import json
from datetime import datetime
import time
import pandas as pd

# =========================================================================================
# == Python 週末完整校驗腳本 完整程式碼 (v1.0 - 完整覆蓋版)
# =========================================================================================

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
GCP_API_KEY = D1_API_KEY

def d1_query(sql, params=None):
    """通用 D1 查詢函式"""
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
    """通用 D1 批次操作函式"""
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
    """從 market_data_coverage 表獲取所有需要完整刷新的標的及其日期範圍"""
    print("正在從 D1 獲取所有需要完整刷新的金融商品列表...")
    # [核心邏輯] 查詢 symbol 和 earliest_date
    sql = "SELECT symbol, earliest_date FROM market_data_coverage"
    targets = d1_query(sql)
    if targets is None:
        return [], []
    
    # 同時獲取所有活躍的使用者 ID 以便後續觸發重算
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql)
    uids = [row['uid'] for row in uid_results if row.get('uid')]

    print(f"找到 {len(targets)} 個需完整刷新的標的。")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    return targets, uids

def fetch_and_overwrite_market_data(targets):
    """
    為每個標的抓取其在 coverage 表中定義的完整日期範圍數據，並覆蓋 D1 資料庫。
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
            
        print(f"--- 正在處理完整刷新: {symbol} (從 {start_date} 開始) ---")
        
        is_fx = "=" in symbol
        price_table = "exchange_rates" if is_fx else "price_history"
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                stock = yf.Ticker(symbol)
                hist = stock.history(start=start_date, interval="1d", auto_adjust=False, back_adjust=False)
                
                if hist.empty:
                    print(f"警告: 找不到 {symbol} 從 {start_date} 開始的歷史數據。")
                    break

                print(f"成功抓取到 {len(hist)} 筆 {symbol} 的完整歷史數據。")
                
                # [核心邏輯] 準備 SQL 指令，先刪除後插入
                db_ops = []
                
                # 1. 刪除舊數據
                db_ops.append({"sql": f"DELETE FROM {price_table} WHERE symbol = ?", "params": [symbol]})
                if not is_fx:
                    db_ops.append({"sql": "DELETE FROM dividend_history WHERE symbol = ?", "params": [symbol]})

                # 2. 插入新數據
                for idx, row in hist.iterrows():
                    date_str = idx.strftime('%Y-%m-%d')
                    if pd.notna(row['Close']):
                        db_ops.append({
                            "sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?)",
                            "params": [symbol, date_str, row['Close']]
                        })
                    if not is_fx and row.get('Dividends', 0) > 0:
                        db_ops.append({
                            "sql": "INSERT INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)",
                            "params": [symbol, date_str, row['Dividends']]
                        })

                if d1_batch(db_ops):
                    print(f"成功覆蓋 {symbol} 的數據到 D1。")
                else:
                    print(f"ERROR: 覆蓋 {symbol} 的數據到 D1 失敗。")
                
                # 更新 coverage 表的最後更新時間
                d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])

                break # 成功後跳出重試迴圈

            except Exception as e:
                print(f"ERROR on attempt {attempt + 1} for {symbol}: {e}")
                if attempt < max_retries - 1:
                    print("5 秒後重試...")
                    time.sleep(5)
                else:
                    print(f"FATAL: 連續 {max_retries} 次抓取 {symbol} 失敗。")


def trigger_recalculations(uids):
    """主動觸發所有使用者的投資組合重新計算"""
    if not uids:
        print("沒有找到需要觸發重算的使用者。")
        return
    if not GCP_API_URL or not GCP_API_KEY:
        print("警告: 缺少 GCP_API_URL 或 GCP_API_KEY，跳過觸發重算。")
        return

    print(f"\n--- 準備為 {len(uids)} 位使用者觸發重算 ---")
    headers = {'X-API-KEY': GCP_API_KEY, 'Content-Type': 'application/json'}
    
    for uid in uids:
        try:
            payload = {"action": "recalculate", "uid": uid}
            response = requests.post(GCP_API_URL, json=payload, headers=headers)
            if response.status_code == 200:
                print(f"成功觸發重算: uid: {uid}")
            else:
                print(f"觸發重算失敗: uid: {uid}. 狀態碼: {response.status_code}, 回應: {response.text}")
        except Exception as e:
            print(f"觸發重算時發生錯誤: uid: {uid}. 錯誤: {e}")
        time.sleep(1) # 避免請求過於頻繁


if __name__ == "__main__":
    print(f"--- 開始執行週末市場數據完整校驗腳本 (v1.0) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    refresh_targets, all_uids = get_full_refresh_targets()
    
    if refresh_targets:
        fetch_and_overwrite_market_data(refresh_targets)
        trigger_recalculations(all_uids)
    else:
        print("在 market_data_coverage 表中沒有找到任何需要刷新的標的。")
        
    print("--- 週末市場數據完整校驗腳本執行完畢 ---")
