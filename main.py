# =========================================================================================
# == Python 每日增量更新腳本 (v5.2 - Robust Retries)
# =========================================================================================

import os
import yfinance as yf
import requests
import json
from datetime import datetime, timedelta
import time
import pandas as pd
import pytz

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
GCP_API_KEY = D1_API_KEY

# ========================= 【核心優化 A - 開始】 =========================
# == 新增：穩健的請求函式，包含錯誤處理與自動重試機制
# =========================================================================================
def robust_request(func, max_retries=3, delay=5, name="Request"):
    """
    一個高階的包裝函式，為任何傳入的函式提供重試邏輯。
    :param func: 需要執行和重試的函式 (lambda or function object)。
    :param max_retries: 最大重試次數。
    :param delay: 每次重試之間的延遲秒數。
    :param name: 用於日誌輸出的操作名稱。
    :return: 傳入函式的回傳值，或者在所有重試失敗後的回傳預設值。
    """
    for attempt in range(1, max_retries + 1):
        try:
            return func()
        except Exception as e:
            print(f"警告: {name} 第 {attempt}/{max_retries} 次嘗試失敗: {e}")
            if attempt == max_retries:
                print(f"FATAL: {name} 在 {max_retries} 次嘗試後最終失敗。")
                return None # 或者根據情境回傳 False, [] 等
            print(f"將在 {delay} 秒後重試...")
            time.sleep(delay)
# ========================= 【核心優化 A - 結束】 =========================


def d1_query(sql, params=None, api_key=None):
    if params is None:
        params = []
    if not api_key:
        print("FATAL: D1 API Key 未提供。")
        return []
        
    headers = {'X-API-KEY': api_key, 'Content-Type': 'application/json'}
    
    # 【優化】使用 robust_request 進行網路請求
    def query_func():
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json().get('results', [])
        
    results = robust_request(query_func, name=f"D1 Query ({sql[:20]}...)")
    return results if results is not None else []


def d1_batch(statements, api_key=None):
    if not api_key:
        print("FATAL: D1 API Key 未提供。")
        return False
    headers = {'X-API-KEY': api_key, 'Content-Type': 'application/json'}
    
    # 【優化】使用 robust_request 進行網路請求
    def batch_func():
        response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": statements}, headers=headers, timeout=60)
        response.raise_for_status()
        return True

    success = robust_request(batch_func, name=f"D1 Batch ({len(statements)} statements)")
    return success if success is not None else False


def get_update_targets():
    print("正在全面獲取所有需要更新的金融商品列表...")
    
    all_symbols = set()
    currency_to_fx = {"USD": "TWD=X", "HKD": "HKDTWD=X", "JPY": "JPYTWD=X"}
    
    holdings_sql = "SELECT DISTINCT symbol FROM holdings"
    holdings_results = d1_query(holdings_sql, api_key=D1_API_KEY)
    if holdings_results:
        for row in holdings_results:
            all_symbols.add(row['symbol'])
            
    currencies_sql = "SELECT DISTINCT currency FROM transactions"
    currencies_results = d1_query(currencies_sql, api_key=D1_API_KEY)
    if currencies_results:
        for row in currencies_results:
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


def get_current_market_session():
    """根據當前 UTC 時間判斷處於哪個市場的主要交易時段"""
    now_utc = datetime.utcnow()
    # 台股交易時段 (UTC 00:30 - 06:00, 考慮到開盤前與盤後)
    if 0 <= now_utc.hour < 7 and now_utc.weekday() < 5:
        return 'TPE'
    # 美股交易時段 (UTC 13:30 - 20:00, 夏令時)
    if 13 <= now_utc.hour < 21 and now_utc.weekday() < 5:
        return 'NYSE'
    return 'CLOSED'

def fetch_intraday_prices(symbols):
    """抓取盤中價，並回傳價格與其對應的市場日期"""
    print("\n--- 【即時更新階段】開始抓取盤中最新價格 ---")
    if not symbols:
        return {}
    
    # 【優化】使用 robust_request 抓取 yfinance 數據
    def yf_intraday_func():
        return yf.download(
            tickers=symbols, period="2d", interval="1m", progress=False,
            auto_adjust=False, back_adjust=False
        )
    
    data = robust_request(yf_intraday_func, name="YFinance Intraday Download")
    if data is None or data.empty:
        print("yfinance 沒有回傳任何盤中數據。")
        return {}

    tz_ny = pytz.timezone('America/New_York')
    tz_taipei = pytz.timezone('Asia/Taipei')
    
    latest_prices = {}
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.swaplevel(0, 1)

    for symbol in symbols:
        try:
            symbol_data = data[symbol] if isinstance(data.columns, pd.MultiIndex) else data
            if not isinstance(symbol_data, pd.DataFrame) or symbol_data.empty or symbol_data['Close'].isnull().all():
                continue

            last_valid_row = symbol_data.dropna(subset=['Close']).iloc[-1]
            last_price = last_valid_row['Close']
            last_timestamp = last_valid_row.name 

            is_tw_stock = '.TW' in symbol.upper() or '.TWO' in symbol.upper()
            market_tz = tz_taipei if is_tw_stock else tz_ny
            
            price_date_in_market_tz = last_timestamp.tz_convert(market_tz).date()
            today_in_market_tz = datetime.now(market_tz).date()

            if price_date_in_market_tz == today_in_market_tz:
                latest_prices[symbol] = {
                    "price": last_price,
                    "date": price_date_in_market_tz.strftime('%Y-%m-%d')
                }
            else:
                print(f"資訊: {symbol} 市場尚未開盤或已收盤，抓取到的是舊價格，本次不進行即時更新。")

        except KeyError:
             print(f"資訊: 在回傳的盤中數據中找不到 {symbol} 的資料。")
    
    print(f"成功獲取 {len(latest_prices)} 筆有效的盤中最新價格。")
    return latest_prices


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
        
        # 【優化】使用 robust_request 抓取 yfinance 數據
        def yf_historical_func():
            return yf.download(tickers=symbols_to_fetch, start=min(start_dates.values()), interval="1d", auto_adjust=False, back_adjust=False, progress=False)

        data = robust_request(yf_historical_func, name="YFinance Historical Download")
        if data is None or data.empty:
            print("yfinance 沒有回傳任何新的歷史數據。")
            continue
        
        print(f"成功抓取到歷史數據，共 {len(data)} 筆時間紀錄。")
        db_ops_upsert = []
        symbols_successfully_processed = []

        for symbol in symbols_to_fetch:
            symbol_data = pd.DataFrame() 

            if isinstance(data.columns, pd.MultiIndex):
                try:
                    symbol_data = data.loc[:, (slice(None), symbol)]
                    symbol_data.columns = symbol_data.columns.droplevel(1)
                except KeyError:
                    print(f"警告: 在 yfinance 回傳的多層級數據中找不到 {symbol} 的資料。")
                    continue
            elif len(symbols_to_fetch) == 1:
                symbol_data = data
            else:
                print(f"警告: 為 {len(symbols_to_fetch)} 個標的請求數據，但 yfinance 返回了無法識別的單一格式。跳過此批次以防止數據錯亂。")
                break 

            is_fx = "=" in symbol
            price_table = "exchange_rates" if is_fx else "price_history"
            dividend_table = "dividend_history"
            
            if symbol_data.empty or 'Close' not in symbol_data.columns or symbol_data['Close'].isnull().all():
                continue
            
            symbol_data = symbol_data.dropna(subset=['Close'])
            symbol_data = symbol_data[symbol_data.index >= pd.to_datetime(start_dates[symbol])]
            if symbol_data.empty:
                continue
            
            price_rows = symbol_data[['Close']].reset_index()
            for _, row in price_rows.iterrows():
                db_ops_upsert.append({"sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;", "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Close']]})
            
            if not is_fx and 'Dividends' in symbol_data.columns:
                dividend_data = symbol_data[symbol_data['Dividends'] > 0]
                if not dividend_data.empty:
                    dividend_rows = dividend_data[['Dividends']].reset_index()
                    for _, row in dividend_rows.iterrows():
                        db_ops_upsert.append({"sql": f"INSERT INTO {dividend_table} (symbol, date, dividend) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET dividend = excluded.dividend;", "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Dividends']]})
            
            symbols_successfully_processed.append(symbol)
        
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
            
    latest_prices_info = fetch_intraday_prices(symbols)
    if latest_prices_info:
        intraday_db_ops = []
        for symbol, info in latest_prices_info.items():
            price = info['price']
            date_str = info['date']
            sql = "INSERT INTO price_history (symbol, date, price) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;"
            intraday_db_ops.append({"sql": sql, "params": [symbol, date_str, price]})
        
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
    
    # 【優化】使用 robust_request 觸發後端 API
    def trigger_func():
        payload = {"action": "recalculate_all_users"}
        response = requests.post(GCP_API_URL, json=payload, headers=headers, timeout=60)
        response.raise_for_status()
        return response
    
    response = robust_request(trigger_func, name="Trigger Recalculations")
    if response and response.status_code == 200:
        print(f"成功觸發所有使用者的重算。")
    elif response:
        print(f"觸發全部重算失敗. 狀態碼: {response.status_code}, 回應: {response.text}")
    else:
        print("觸發全部重算最終失敗。")


if __name__ == "__main__":
    print(f"--- 開始執行每日市場數據增量更新腳本 (v5.2 - Robust Retries) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    session = get_current_market_session()
    print(f"偵測到當前市場時段: {session}")

    all_symbols, all_uids = get_update_targets()
    
    symbols_to_process = []
    if session == 'TPE':
        print("篩選目標：僅處理台股 (.TW, .TWO) 及匯率相關標的。")
        symbols_to_process = [
            s for s in all_symbols 
            if s.upper().endswith('.TW') or s.upper().endswith('.TWO') or '=' in s
        ]
    elif session == 'NYSE':
        print("篩選目標：僅處理非台股的美股及其他國際市場標的。")
        symbols_to_process = [
            s for s in all_symbols 
            if not s.upper().endswith('.TW') and not s.upper().endswith('.TWO')
        ]
    else: # 'CLOSED'
        print("市場休市中，腳本將僅執行歷史數據補全，不抓取即時盤中價。")
        symbols_to_process = all_symbols

    if symbols_to_process:
        print(f"最終將處理 {len(symbols_to_process)} 個標的: {symbols_to_process}")
        fetch_and_append_market_data(symbols_to_process)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("根據當前市場時段，沒有需要處理的標的。")

    print(f"--- 每日市場數據增量更新腳本執行完畢 --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
