# =========================================================================================
# == Python 週末完整校驗腳本 (v2.4 - 精確多工優化版)
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
    """
    執行 D1 查詢。
    【v3.5.1 修正】: 當 API 請求失敗時，回傳一個空的 list 而不是 None，
                     以防止後續的迭代操作出錯，讓腳本更具韌性。
    """
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

def get_full_refresh_targets():
    """
    全面獲取需要更新的標的列表、Benchmark 列表、使用者列表，以及全局最早的交易日期。
    v2.2: 標的來源改為所有歷史交易紀錄，確保已出清持股也能被更新。
    """
    print("正在全面獲取所有需要完整刷新的金融商品列表...")
    
    all_symbols = set()
    benchmark_symbols = set()
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
            symbol = row['symbol']
            if symbol:
                all_symbols.add(symbol)
                benchmark_symbols.add(symbol)

    targets = list(filter(None, all_symbols))
    
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql)
    uids = [row['uid'] for row in uid_results if row.get('uid')] if uid_results else []

    global_earliest_date_result = d1_query("SELECT MIN(date) as earliest_date FROM transactions")
    global_earliest_tx_date = None
    if global_earliest_date_result and global_earliest_date_result[0].get('earliest_date'):
        global_earliest_tx_date = global_earliest_date_result[0]['earliest_date'].split('T')[0]
        print(f"找到全域最早的交易日期: {global_earliest_tx_date}")
    else:
        print("警告: 找不到任何交易紀錄，Benchmark 和匯率的歷史將不會被抓取。")

    print(f"找到 {len(targets)} 個需全面刷新的標的: {targets}")
    print(f"從資料庫找到 {len(benchmark_symbols)} 個 Benchmark: {benchmark_symbols}")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    
    return targets, benchmark_symbols, uids, global_earliest_tx_date

def fetch_and_overwrite_market_data(targets, benchmark_symbols, global_earliest_tx_date, batch_size=10):
    """
    (安全模式) 為每個標的抓取完整歷史數據，使用統一化的起始日期策略和多工批次處理。
    """
    if not targets:
        print("沒有需要刷新的標的。")
        return

    today_str = datetime.now().strftime('%Y-%m-%d')
    symbol_batches = [targets[i:i + batch_size] for i in range(0, len(targets), batch_size)]

    for i, batch in enumerate(symbol_batches):
        print(f"\n--- 正在處理完整刷新批次 {i+1}/{len(symbol_batches)}: {batch} ---")
        
        start_dates = {}
        symbols_to_fetch_in_batch = []
        
        for symbol in batch:
            is_fx = "=" in symbol
            is_benchmark = symbol in benchmark_symbols
            start_date = None
            
            if is_benchmark or is_fx:
                start_date = global_earliest_tx_date
            else:
                symbol_earliest_date_result = d1_query("SELECT MIN(date) as earliest_date FROM transactions WHERE symbol = ?", [symbol])
                if symbol_earliest_date_result and symbol_earliest_date_result[0].get('earliest_date'):
                    start_date = symbol_earliest_date_result[0]['earliest_date'].split('T')[0]
            
            if not start_date:
                print(f"警告: 找不到 {symbol} 的有效起始日期。跳過此標的。")
                continue
                
            start_dates[symbol] = start_date
            symbols_to_fetch_in_batch.append(symbol)

        if not symbols_to_fetch_in_batch:
            print("此批次所有標的都無需抓取。")
            continue

        print(f"準備從 yfinance 併發抓取 {len(symbols_to_fetch_in_batch)} 筆完整歷史數據...")
        try:
            data = yf.download(
                tickers=symbols_to_fetch_in_batch,
                start=min(start_dates.values()),
                interval="1d",
                auto_adjust=False,
                back_adjust=False,
                progress=False
            )
            
            if data.empty:
                print("yfinance 沒有回傳任何數據。")
                continue

            print(f"成功抓取到數據，共 {len(data)} 筆時間紀錄。")
            
            db_ops_swap = []
            for symbol in symbols_to_fetch_in_batch:
                is_fx = "=" in symbol
                price_table = "exchange_rates" if is_fx else "price_history"
                dividend_table = "dividend_history"
                
                symbol_data = data.loc[:, data.columns.get_level_values(1)==symbol] if len(symbols_to_fetch_in_batch) > 1 else data
                if len(symbols_to_fetch_in_batch) > 1:
                    symbol_data.columns = symbol_data.columns.droplevel(1)
                
                symbol_data = symbol_data.dropna(subset=['Close'])
                
                # --- 【關鍵修改】在這裡根據每支股票自己的起始日來過濾數據 ---
                symbol_data = symbol_data[symbol_data.index >= pd.to_datetime(start_dates[symbol])]

                if symbol_data.empty:
                    print(f"警告: {symbol} 在其交易歷史 {start_dates[symbol]} 之後沒有有效的歷史數據。")
                    continue
                
                db_ops_swap.append({"sql": f"DELETE FROM {price_table} WHERE symbol = ?", "params": [symbol]})
                if not is_fx:
                    db_ops_swap.append({"sql": f"DELETE FROM {dividend_table} WHERE symbol = ?", "params": [symbol]})

                price_rows = symbol_data[['Close']].reset_index()
                for _, row in price_rows.iterrows():
                    db_ops_swap.append({
                        "sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?)",
                        "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Close']]
                    })
                
                if not is_fx and 'Dividends' in symbol_data.columns:
                    dividend_rows = symbol_data[symbol_data['Dividends'] > 0][['Dividends']].reset_index()
                    for _, row in dividend_rows.iterrows():
                        db_ops_swap.append({
                            "sql": f"INSERT INTO {dividend_table} (symbol, date, dividend) VALUES (?, ?, ?)",
                            "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Dividends']]
                        })
            
            if db_ops_swap:
                print(f"正在為批次 {batch} 準備 {len(db_ops_swap)} 筆資料庫覆蓋操作...")
                if d1_batch(db_ops_swap):
                    print(f"成功！ 批次 {batch} 的正式表數據已原子性更新。")
                    for symbol in symbols_to_fetch_in_batch:
                         d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
                else:
                    print(f"FATAL: 原子性替換批次 {batch} 的數據失敗！")

        except Exception as e:
            print(f"處理批次 {batch} 時發生錯誤: {e}")
            print("5 秒後繼續處理下一個批次...")
            time.sleep(5)


def trigger_recalculations(uids):
    """觸發所有使用者的後端重算"""
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
    print(f"--- 開始執行週末市場數據完整校驗腳本 (v2.4 - 精確多工優化版) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    refresh_targets, benchmark_symbols, all_uids, global_start_date = get_full_refresh_targets()
    if refresh_targets:
        fetch_and_overwrite_market_data(refresh_targets, benchmark_symbols, global_start_date)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("資料庫中沒有找到任何需要刷新的標的 (無持股、無Benchmark)。")
    print(f"--- 週末市場數據完整校驗腳本執行完畢 --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
