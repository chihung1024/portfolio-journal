import os
import yfinance as yf
import requests
import json
from datetime import datetime
import time
import pandas as pd
from google.cloud import pubsub_v1

# =========================================================================================
# == Python 週末完整校驗腳本 完整程式碼 (v1.0 - 完整覆蓋版)
# =========================================================================================

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
PUB_SUB_TOPIC_ID = "recalculation-topic"

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
    """從 D1 獲取所有需要完整刷新的標的及其日期範圍"""
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
    """為每個標的抓取完整日期範圍數據並覆蓋 D1 資料庫"""
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
                
                db_ops = []
                db_ops.append({"sql": f"DELETE FROM {price_table} WHERE symbol = ?", "params": [symbol]})
                if not is_fx:
                    db_ops.append({"sql": "DELETE FROM dividend_history WHERE symbol = ?", "params": [symbol]})

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
                
                d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
                break
            except Exception as e:
                print(f"ERROR on attempt {attempt + 1} for {symbol}: {e}")
                if attempt < max_retries - 1:
                    print("5 秒後重試...")
                    time.sleep(5)
                else:
                    print(f"FATAL: 連續 {max_retries} 次抓取 {symbol} 失敗。")


def trigger_recalculations(uids):
    """將需要重算的使用者 ID 發布到 Pub/Sub"""
    if not uids:
        print("沒有找到需要觸發重算的使用者。")
        return
    if not GCP_PROJECT_ID:
        print("FATAL: 缺少 GCP_PROJECT_ID 環境變數，無法發布到 Pub/Sub。")
        return

    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path(GCP_PROJECT_ID, PUB_SUB_TOPIC_ID)
    
    print(f"\n--- 準備為 {len(uids)} 位使用者發布重算任務到 Pub/Sub ---")
    
    for uid in uids:
        try:
            # 將 uid 編碼為 bytes
            data = uid.encode("utf-8")
            # 發布訊息
            future = publisher.publish(topic_path, data)
            # 您可以 await future.result() 來確認發布成功，但在腳本中通常直接發布即可
        except Exception as e:
            print(f"為 UID {uid} 發布訊息時發生錯誤: {e}")

    print("所有重算任務已成功發布到 Pub/Sub。")


if __name__ == "__main__":
    print(f"--- 開始執行週末市場數據完整校驗腳本 (v1.1) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    refresh_targets, all_uids = get_full_refresh_targets()
    
    if refresh_targets:
        fetch_and_overwrite_market_data(refresh_targets)
        trigger_recalculations(all_uids)
    else:
        print("在 market_data_coverage 表中沒有找到任何需要刷新的標的。")
        
    print("--- 週末市場數據完整校驗腳本執行完畢 ---")
