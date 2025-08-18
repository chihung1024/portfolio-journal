# =========================================================================================
# == Python 每日增量更新腳本 (v4.8 - Debugged & Optimized)
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

def d1_query(sql, params=None, api_key=None):
    if params is None:
        params = []
    if not api_key:
        print("FATAL: D1 API Key 未提供。")
        return []
    headers = {'X-API-KEY': api_key, 'Content-Type': 'application/json'}
    try:
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers)
        response.raise_for_status()
        return response.json().get('results', [])
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return []

def d1_batch(statements, api_key=None):
    if not api_key:
        print("FATAL: D1 API Key 未提供。")
        return False
    headers = {'X-API-KEY': api_key, 'Content-Type': 'application/json'}
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

    holdings_sql = "SELECT DISTINCT symbol, currency FROM holdings"
    holdings_results = d1_query(holdings_sql, api_key=D1_API_KEY)
    if holdings_results:
        for row in holdings_results:
            all_symbols.add(row['symbol'])
            currency = row.get('currency')
            if currency and currency in currency_to_fx:
                all_symbols.add(currency_to_fx[currency])
                
    benchmark_sql = "SELECT DISTINCT value AS symbol FROM controls WHERE key = 'benchmarkSymbol'"
    benchmark_results = d1_query(benchmark_sql, api_key=D1_API_KEY)
    if benchmark_results:
        for row in benchmark_results:
            all_symbols.add(row['symbol'])
    
    symbols_list = list(filter(None, all_symbols))
    
    uid_sql = "SELECT DISTINCT uid FROM transactions"
    uid_results = d1_query(uid_sql, api_key=D1_API_KEY)
    uids = [row['uid'] for row in uid_results if row.get('uid')] if uid_results else []

    print(f"找到 {len(symbols_list)} 個需更新的標的 (含持股、匯率、Benchmark): {symbols_list}")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    return symbols_list, uids

def fetch_intraday_prices(symbols):
    """
    使用 1 分鐘間隔抓取當日數據，以獲取最新的盤中價格。
    """
    print("\n--- 【即時更新階段】開始抓取盤中最新價格 ---")
    if not symbols:
        return {}
    
    try:
        stock_symbols = [s for s in symbols if "=" not in s]
        if not stock_symbols:
            print("沒有需要抓取盤中價的股票標的。")
            return {}

        data = yf.download(
            tickers=stock_symbols,
            period="1d",
            interval="1m",
            progress=False,
            auto_adjust=False, 
            back_adjust=False
        )
        if data.empty:
            print("yfinance 沒有回傳任何盤中數據。")
            return {}

        latest_prices = {}
        # 處理多股票回傳時的多層級欄位
        if len(stock_symbols) > 1:
            data.columns = data.columns.swaplevel(0, 1)

        for symbol in stock_symbols:
            try:
                # 確保我們總是在處理一個 DataFrame
                symbol_data = data[symbol] if len(stock_symbols) > 1 else data
                if not isinstance(symbol_data, pd.DataFrame):
                    continue

                if not symbol_data.empty and 'Close' in symbol_data.columns:
                    last_price = symbol_data['Close'].dropna().iloc[-1]
                    latest_prices[symbol] = last_price
            except KeyError:
                 print(f"資訊: 在回傳的盤中數據中找不到 {symbol} 的資料 (可能今日未交易)。")

        print(f"成功獲取 {len(latest_prices)} 筆盤中最新價格。")
        return latest_prices

    except Exception as e:
        print(f"抓取盤中價格時發生錯誤: {e}")
        return {}


def fetch_and_append_market_data(symbols, batch_size=10):
    if not symbols:
        print("沒有需要更新的標的。")
        return

    print("\n--- 【歷史數據階段】開始更新每日歷史收盤價 ---")
    
    placeholders_all = ','.join('?' for _ in symbols)
    all_first_tx_sql = f"SELECT symbol, MIN(date) as first_tx_date FROM transactions WHERE symbol IN ({placeholders_all}) GROUP BY symbol"
    first_tx_dates_results = d1_query(all_first_tx_sql, symbols, api_key=D1_API_KEY)
    first_tx_dates = {row['symbol']: row['first_tx_date'].split('T')[0] for row in first_tx_dates_results if row.get('first_tx_date')}
    
    today_str = datetime.now().strftime('%Y-%m-%d')
    symbol_batches = [symbols[i:i + batch_size] for i in range(0, len(symbols), batch_size)]

    for i, batch in enumerate(symbol_batches):
        print(f"\n--- 正在處理歷史數據批次 {i+1}/{len(symbol_batches)}: {batch} ---")
        
        placeholders = ','.join('?' for _ in batch)
        price_history_sql = f"SELECT symbol, MAX(date) as latest_date FROM price_history WHERE symbol IN ({placeholders}) GROUP BY symbol"
        price_results = d1_query(price_history_sql, batch, api_key=D1_API_KEY)
        exchange_rates_sql = f"SELECT symbol, MAX(date) as latest_date FROM exchange_rates WHERE symbol IN ({placeholders}) GROUP BY symbol"
        fx_results = d1_query(exchange_rates_sql, batch, api_key=D1_API_KEY)
        
        latest_dates = {row['symbol']: row['latest_date'].split('T')[0] for row in (price_results or []) if row.get('latest_date')}
        latest_dates.update({row['symbol']: row['latest_date'].split('T')[0] for row in (fx_results or []) if row.get('latest_date')})
        
        start_dates = {}
        symbols_to_fetch = []
        for symbol in batch:
            latest_date_str = latest_dates.get(symbol)
            start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d') if latest_date_str else first_tx_dates.get(symbol, "2000-01-01")
            
            if start_date > today_str:
                continue

            start_dates[symbol] = start_date
            symbols_to_fetch.append(symbol)

        if not symbols_to_fetch:
            print("此批次所有標的歷史數據都已是最新，跳過抓取。")
            continue

        print(f"準備從 yfinance 併發抓取 {len(symbols_to_fetch)} 筆歷史數據...")
        try:
            data = yf.download(tickers=symbols_to_fetch, start=min(start_dates.values()), interval="1d", auto_adjust=False, back_adjust=False, progress=False)
            if data.empty:
                print("yfinance 沒有回傳任何新的歷史數據。")
                continue
            
            print(f"成功抓取到歷史數據，共 {len(data)} 筆時間紀錄。")
            db_ops_upsert = []
            symbols_successfully_processed = []

            # ========================= 【核心偵錯邏輯開始】 =========================
            for symbol in symbols_to_fetch:
                symbol_data = pd.DataFrame() # 初始化一個空的 DataFrame

                # 判斷回傳資料的結構
                if isinstance(data.columns, pd.MultiIndex):
                    # --- 情況 1: 成功抓取多筆資料，為多層級欄位 ---
                    try:
                        # 安全地選取該 symbol 的所有欄位
                        symbol_data = data.loc[:, (slice(None), symbol)]
                        # 移除多餘的 symbol 層級，變回單層級欄位
                        symbol_data.columns = symbol_data.columns.droplevel(1)
                    except KeyError:
                        print(f"警告: 在 yfinance 回傳的多層級數據中找不到 {symbol} 的資料。")
                        continue
                elif len(symbols_to_fetch) == 1:
                    # --- 情況 2: 只請求一筆資料，為單層級欄位 ---
                    symbol_data = data
                else:
                    # --- 情況 3: 請求多筆但只回傳一筆，yfinance 回傳單層級欄位 ---
                    # 這種情況我們無法確定這個資料屬於哪個 symbol，為避免資料錯亂，直接跳過。
                    print(f"警告: 為 {len(symbols_to_fetch)} 個標的請求數據，但 yfinance 返回了無法識別的單一格式。跳過此批次以防止數據錯亂。")
                    break # 跳出 for 迴圈，處理下一個批次

                is_fx = "=" in symbol
                price_table = "exchange_rates" if is_fx else "price_history"
                dividend_table = "dividend_history"
                
                if symbol_data.empty or 'Close' not in symbol_data.columns or symbol_data['Close'].isnull().all():
                    continue
                
                symbol_data = symbol_data.dropna(subset=['Close'])
                symbol_data = symbol_data[symbol_data.index >= pd.to_datetime(start_dates[symbol])]
                if symbol_data.empty:
                    continue
                
                # 處理股價 (邏輯不變)
                price_rows = symbol_data[['Close']].reset_index()
                for _, row in price_rows.iterrows():
                    db_ops_upsert.append({"sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;", "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Close']]})
                
                # 處理股利 (邏輯不變)
                if not is_fx and 'Dividends' in symbol_data.columns:
                    dividend_data = symbol_data[symbol_data['Dividends'] > 0]
                    if not dividend_data.empty:
                        dividend_rows = dividend_data[['Dividends']].reset_index()
                        for _, row in dividend_rows.iterrows():
                            db_ops_upsert.append({"sql": f"INSERT INTO {dividend_table} (symbol, date, dividend) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET dividend = excluded.dividend;", "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Dividends']]})
                
                symbols_successfully_processed.append(symbol)
            # ========================== 【核心偵錯邏輯結束】 ==========================

            if db_ops_upsert:
                print(f"正在為批次 {batch} 準備 {len(db_ops_upsert)} 筆歷史數據庫操作...")
                if d1_batch(db_ops_upsert, api_key=D1_API_KEY):
                    print(f"成功！ 批次 {batch} 的歷史數據已安全地更新/寫入。")
                    
                    coverage_updates = []
                    for symbol in symbols_successfully_processed:
                        symbol_start_date = start_dates.get(symbol, first_tx_dates.get(symbol)) 
                        if symbol_start_date:
                            coverage_updates.append({
                                "sql": "INSERT OR REPLACE INTO market_data_coverage (symbol, earliest_date, last_updated) VALUES (?, ?, ?)",
                                "params": [symbol, symbol_start_date, today_str]
                            })
                    if coverage_updates and not d1_batch(coverage_updates, api_key=D1_API_KEY):
                        print(f"警告: 更新批次 {batch} 的 market_data_coverage 狀態失敗。")
                else:
                    print(f"FATAL: 更新/插入批次 {batch} 的歷史數據失敗！")
        
        except Exception as e:
            print(f"處理歷史數據批次 {batch} 時發生嚴重錯誤: {e}")
            print("5 秒後繼續處理下一個批次...")
            time.sleep(5)
            
    latest_prices = fetch_intraday_prices(symbols)
    if latest_prices:
        intraday_db_ops = []
        today_str = datetime.now().strftime('%Y-%m-%d')
        for symbol, price in latest_prices.items():
            sql = "INSERT INTO price_history (symbol, date, price) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;"
            intraday_db_ops.append({"sql": sql, "params": [symbol, today_str, price]})
        
        if intraday_db_ops:
            print(f"準備將 {len(intraday_db_ops)} 筆盤中價格寫入資料庫...")
            if d1_batch(intraday_db_ops, api_key=D1_API_KEY):
                print("成功將盤中最新價格更新至資料庫！")
            else:
                print("FATAL: 寫入盤中價格失敗！")

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
    print(f"--- 開始執行每日市場數據增量更新腳本 (v4.8 - Debugged & Optimized) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    update_symbols, all_uids = get_update_targets()
    if update_symbols:
        fetch_and_append_market_data(update_symbols)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("資料庫中沒有找到任何需要更新的標的。")
    print(f"--- 每日市場數據增量更新腳本執行完畢 --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
