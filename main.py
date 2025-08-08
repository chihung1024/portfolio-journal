import os
import yfinance as yf
import requests
import json
from datetime import datetime, timedelta
import time
import pandas as pd
# [新增] 引入 Pub/Sub 客戶端和 os 模組以讀取專案ID
from google.cloud import pubsub_v1

# =========================================================================================
# == Python 每日增量更新腳本 完整程式碼 (v3.0 - 增量更新版) -> (v4.0 - Pub/Sub 觸發版)
# =========================================================================================

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")

# [新增] GCP Pub/Sub 設定
GCP_PROJECT_ID = "portfolio-journal-467915"  # 您的 GCP 專案 ID
PUB_SUB_TOPIC_ID = "recalculation-topic"    # 您建立的 Pub/Sub 主題 ID

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
    """從 market_data_coverage 表獲取所有需要更新的標的"""
    print("正在從 D1 獲取所有需要更新的金融商品列表...")
    sql = "SELECT symbol FROM market_data_coverage"
    results = d1_query(sql)
    if results is None:
        return [], []
    
    symbols = [row['symbol'] for row in results if row.get('symbol')]
    
    # 同時獲取所有活躍的使用者 ID 以便後續觸發重算
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql)
    uids = [row['uid'] for row in uid_results if row.get('uid')]

    print(f"找到 {len(symbols)} 個需更新的標的: {symbols}")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    return symbols, uids

def fetch_and_append_market_data(symbols):
    """
    為每個標的抓取從上次更新到現在的增量數據，並附加到 D1 資料庫。
    """
    if not symbols:
        print("沒有需要更新的標的。")
        return

    today_str = datetime.now().strftime('%Y-%m-%d')

    for symbol in symbols:
        if not symbol: continue
        print(f"--- 正在處理增量更新: {symbol} ---")
        
        is_fx = "=" in symbol
        price_table = "exchange_rates" if is_fx else "price_history"
        
        # 1. 查詢資料庫中該標的的最新日期
        latest_date_sql = f"SELECT MAX(date) as latest_date FROM {price_table} WHERE symbol = ?"
        result = d1_query(latest_date_sql, [symbol])
        
        latest_date_str = None
        if result and result[0].get('latest_date'):
            latest_date_str = result[0]['latest_date'].split('T')[0]
        
        if not latest_date_str:
            print(f"警告: 在 {price_table} 中找不到 {symbol} 的任何紀錄，將從 2000-01-01 開始抓取。")
            start_date = "2000-01-01"
        else:
            # 從最新日期的隔天開始抓取
            start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')

        if start_date >= today_str:
            print(f"{symbol} 的數據已是最新 ({latest_date_str})，無需更新。")
            continue

        print(f"準備抓取 {symbol} 從 {start_date} 到今天的數據...")

        # 2. 使用 yfinance 抓取增量數據
        max_retries = 3
        for attempt in range(max_retries):
            try:
                stock = yf.Ticker(symbol)
                # 結束日期設為明天，確保能抓到今天的數據
                end_date_fetch = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
                hist = stock.history(start=start_date, end=end_date_fetch, interval="1d", auto_adjust=False, back_adjust=False)
                
                if hist.empty:
                    print(f"在 {start_date} 之後沒有找到 {symbol} 的新數據。")
                    break

                print(f"成功抓取到 {len(hist)} 筆 {symbol} 的新數據。")
                
                # 3. 準備 SQL 指令並批次寫入
                db_ops = []
                for idx, row in hist.iterrows():
                    date_str = idx.strftime('%Y-%m-%d')
                    if pd.notna(row['Close']):
                        db_ops.append({
                            "sql": f"INSERT OR IGNORE INTO {price_table} (symbol, date, price) VALUES (?, ?, ?)",
                            "params": [symbol, date_str, row['Close']]
                        })
                    if not is_fx and row['Dividends'] > 0:
                        db_ops.append({
                            "sql": "INSERT OR IGNORE INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)",
                            "params": [symbol, date_str, row['Dividends']]
                        })

                if db_ops:
                    if d1_batch(db_ops):
                        print(f"成功將 {len(db_ops)} 筆新紀錄寫入 D1 for {symbol}.")
                    else:
                        print(f"ERROR: 寫入 {symbol} 的新紀錄到 D1 失敗。")
                
                d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])

                break 

            except Exception as e:
                print(f"ERROR on attempt {attempt + 1} for {symbol}: {e}")
                if attempt < max_retries - 1:
                    print("5 秒後重試...")
                    time.sleep(5)
                else:
                    print(f"FATAL: 連續 {max_retries} 次抓取 {symbol} 失敗。")


def publish_recalculation_tasks(uids, create_snapshot=False):
    """[新增] 將重算任務作為訊息發佈到 Pub/Sub 主題"""
    if not uids:
        print("沒有找到需要觸發重算的使用者。")
        return
        
    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path(GCP_PROJECT_ID, PUB_SUB_TOPIC_ID)
    
    print(f"\n--- 準備為 {len(uids)} 位使用者發佈重算任務到 Pub/Sub ---")
    
    published_count = 0
    for uid in uids:
        message_data = {
            "uid": uid,
            "createSnapshot": create_snapshot
        }
        # 訊息內容需為 bytes 格式
        future = publisher.publish(topic_path, json.dumps(message_data).encode("utf-8"))
        # .result() 會等待發佈完成，但通常非同步發送即可
        # print(f"Published message ID: {future.result()}")
        published_count += 1
        
    print(f"成功發佈 {published_count} 個任務。後端將非同步處理。")


if __name__ == "__main__":
    print(f"--- 開始執行每日市場數據增量更新腳本 (v4.0 - Pub/Sub) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    update_symbols, all_uids = get_update_targets()
    
    if update_symbols:
        fetch_and_append_market_data(update_symbols)
        # [修改] 不再呼叫 HTTP 端點，而是發佈任務
        if all_uids:
            publish_recalculation_tasks(all_uids, create_snapshot=False)
    else:
        print("在 market_data_coverage 表中沒有找到任何需要更新的標的。")
        
    print("--- 每日市場數據增量更新腳本執行完畢 ---")
