# =========================================================================================
# == Python 每日增量更新腳本 (v3.9 - 最終審查優化版)
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
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers)
        response.raise_for_status()
        return response.json().get('results', [])
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return []

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
    """從三個來源全面獲取需要更新的標的列表"""
    print("正在全面獲取所有需要更新的金融商品列表...")
    
    all_symbols = set()
    currency_to_fx = {"USD": "TWD=X", "HKD": "HKDTWD=X", "JPY": "JPYTWD=X"}

    transactions_sql = "SELECT DISTINCT symbol FROM transactions"
    tx_symbols_results = d1_query(transactions_sql)
    if tx_symbols_results:
        for row in tx_symbols_results:
            all_symbols.add(row['symbol'])

    currencies_sql = "SELECT DISTINCT currency FROM transactions"
    currencies_results = d1_query(currencies_sql)
    if currencies_results:
        for row in currencies_results:
            currency = row.get('currency')
            if currency and currency in currency_to_fx:
                all_symbols.add(currency_to_fx[currency])
                
    benchmark_sql = "SELECT DISTINCT value AS symbol FROM controls WHERE key = 'benchmarkSymbol'"
    benchmark_results = d1_query(benchmark_sql)
    if benchmark_results:
        for row in benchmark_results:
            all_symbols.add(row['symbol'])
    
    symbols_list = list(filter(None, all_symbols))
    
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql)
    uids = [row['uid'] for row in uid_results if row.get('uid')] if uid_results else []

    print(f"找到 {len(symbols_list)} 個需全面更新的標的: {symbols_list}")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    return symbols_list, uids


def fetch_and_append_market_data(symbols, batch_size=10):
    if not symbols:
        print("沒有需要更新的標的。")
        return

    # --- 【改善建議 1】一次性獲取所有標的的首次交易日 ---
    print("正在一次性查詢所有標的的首次交易日...")
    placeholders_all = ','.join('?' for _ in symbols)
    all_first_tx_sql = f"SELECT symbol, MIN(date) as first_tx_date FROM transactions WHERE symbol IN ({placeholders_all}) GROUP BY symbol"
    first_tx_dates_results = d1_query(all_first_tx_sql, symbols)
    first_tx_dates = {row['symbol']: row['first_tx_date'].split('T')[0] for row in first_tx_dates_results if row.get('first_tx_date')}
    print("查詢完成。")

    today_str = datetime.now().strftime('%Y-%m-%d')
    symbol_batches = [symbols[i:i + batch_size] for i in range(0, len(symbols), batch_size)]

    for i, batch in enumerate(symbol_batches):
        print(f"\n--- 正在處理批次 {i+1}/{len(symbol_batches)}: {batch} ---")
        
        placeholders = ','.join('?' for _ in batch)
        
        price_history_sql = f"SELECT symbol, MAX(date) as latest_date FROM price_history WHERE symbol IN ({placeholders}) GROUP BY symbol"
        price_results = d1_query(price_history_sql, batch)

        exchange_rates_sql = f"SELECT symbol, MAX(date) as latest_date FROM exchange_rates WHERE symbol IN ({placeholders}) GROUP BY symbol"
        fx_results = d1_query(exchange_rates_sql, batch)
        
        latest_dates = {row['symbol']: row['latest_date'].split('T')[0] for row in (price_results or []) if row.get('latest_date')}
        latest_dates.update({row['symbol']: row['latest_date'].split('T')[0] for row in (fx_results or []) if row.get('latest_date')})
        
        start_dates = {}
        symbols_to_fetch = []
        for symbol in batch:
            latest_date_str = latest_dates.get(symbol)
            start_date = None
            
            if latest_date_str:
                if latest_date_str == today_str:
                    start_date = today_str
                else:
                    start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
            else:
                # 不再查詢資料庫，而是從預先查好的字典中取值
                start_date = first_tx_dates.get(symbol, "2000-01-01")
            
            if start_date > today_str:
                print(f"{symbol} 的數據已是最新 ({latest_date_str})，無需更新。")
                continue

            start_dates[symbol] = start_date
            symbols_to_fetch.append(symbol)

        if not symbols_to_fetch:
            print("此批次所有標的都已是最新，跳過抓取。")
            continue

        print(f"準備從 yfinance 併發抓取 {len(symbols_to_fetch)} 筆數據...")
        try:
            data = yf.download(
                tickers=symbols_to_fetch,
                start=min(start_dates.values()),
                interval="1d",
                auto_adjust=False,
                back_adjust=False,
                progress=False
            )
            
            if data.empty:
                print("yfinance 沒有回傳任何新數據。")
                continue
            
            print(f"成功抓取到數據，共 {len(data)} 筆時間紀錄。")

            db_ops_upsert = []
            symbols_successfully_processed = []
            for symbol in symbols_to_fetch:
                is_fx = "=" in symbol
                price_table = "exchange_rates" if is_fx else "price_history"
                dividend_table = "dividend_history"
                
                symbol_data = data.loc[:, data.columns.get_level_values(1)==symbol] if len(symbols_to_fetch) > 1 else data
                if len(symbols_to_fetch) > 1:
                    symbol_data.columns = symbol_data.columns.droplevel(1)
                
                if symbol_data.empty or ('Close' in symbol_data.columns and symbol_data['Close'].isnull().all()):
                    print(f"警告: {symbol} 在 yfinance 的回傳數據中無效或全為 NaN。跳過此標的。")
                    continue

                symbol_data = symbol_data.dropna(subset=['Close'])
                symbol_data = symbol_data[symbol_data.index >= pd.to_datetime(start_dates[symbol])]

                if symbol_data.empty:
                    print(f"在 {start_dates[symbol]} 之後沒有找到 {symbol} 的新數據。")
                    continue
                
                price_rows = symbol_data[['Close']].reset_index()
                for _, row in price_rows.iterrows():
                    db_ops_upsert.append({
                        "sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;",
                        "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Close']]
                    })
                
                if not is_fx and 'Dividends' in symbol_data.columns:
                    dividend_rows = symbol_data[symbol_data['Dividends'] > 0][['Dividends']].reset_index()
                    for _, row in dividend_rows.iterrows():
                        db_ops_upsert.append({
                            "sql": f"INSERT INTO {dividend_table} (symbol, date, dividend) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET dividend = excluded.dividend;",
                            "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Dividends']]
                        })
                
                symbols_successfully_processed.append(symbol)

            if db_ops_upsert:
                print(f"正在為批次 {batch} 準備 {len(db_ops_upsert)} 筆資料庫 Upsert 操作...")
                if d1_batch(db_ops_upsert):
                    print(f"成功！ 批次 {batch} 的增量數據已安全地更新/寫入。")
                    
                    # --- 【改善建議 2】使用 UPSERT 邏輯更新 coverage 表 ---
                    coverage_updates = []
                    for symbol in symbols_successfully_processed:
                        coverage_updates.append({
                            "sql": "INSERT INTO market_data_coverage (symbol, last_updated) VALUES (?, ?) ON CONFLICT(symbol) DO UPDATE SET last_updated = excluded.last_updated;",
                            "params": [symbol, today_str]
                        })
                    if coverage_updates and not d1_batch(coverage_updates):
                        print(f"警告: 更新批次 {batch} 的 market_data_coverage 狀態失敗。")
                else:
                    print(f"FATAL: 更新/插入批次 {batch} 的數據失敗！")
        
        except Exception as e:
            print(f"處理批次 {batch} 時發生錯誤: {e}")
            print("5 秒後繼續處理下一個批次...")
            time.sleep(5)

def trigger_recalculations(uids):
    """觸發所有使用者的後端重算"""
    # (此函式維持不變)
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
    headers = {'X-API-KEY': GCP_API_KEY, 'Content-Type': 'application/json', 'X-Service-Account-Key': SERVICE_ACCOUNT_KEY}
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
    print(f"--- 開始執行每日市場數據增量更新腳本 (v3.9 - 最終審查優化版) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    update_symbols, all_uids = get_update_targets()
    if update_symbols:
        fetch_and_append_market_data(update_symbols)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("資料庫中沒有找到任何需要刷新的標的。")
    print(f"--- 每日市場數據增量更新腳本執行完畢 --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
