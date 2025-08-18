# =========================================================================================
# == Python 每日增量更新腳本 (v4.4 - 混合即時更新版)
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


# 【新增】專門用來抓取盤中最新價格的函式
def fetch_intraday_prices(symbols):
    """
    使用 1 分鐘間隔抓取當日數據，以獲取最新的盤中價格。
    """
    print("\n--- 【即時更新階段】開始抓取盤中最新價格 ---")
    if not symbols:
        return {}
    
    try:
        # 只抓取股票和 ETF，過濾掉匯率
        stock_symbols = [s for s in symbols if "=" not in s]
        if not stock_symbols:
            print("沒有需要抓取盤中價的股票標的。")
            return {}

        # period="1d" 和 interval="1m" 結合可以獲取當天的分鐘線數據
        data = yf.download(
            tickers=stock_symbols,
            period="1d",
            interval="1m",
            progress=False
        )
        if data.empty:
            return {}

        latest_prices = {}
        for symbol in stock_symbols:
            # 處理多股票和單股票的回傳格式差異
            symbol_data = data.loc[:, data.columns.get_level_values(1)==symbol] if len(stock_symbols) > 1 else data
            if len(stock_symbols) > 1:
                symbol_data.columns = symbol_data.columns.droplevel(1)

            if not symbol_data.empty and 'Close' in symbol_data.columns:
                # 取得最後一筆有效的價格
                last_price = symbol_data['Close'].dropna().iloc[-1]
                latest_prices[symbol] = last_price
        
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
    # ... (此函式前半部分的歷史數據更新邏輯維持不變) ...
    print("正在一次性查詢所有標的的首次交易日...")
    placeholders_all = ','.join('?' for _ in symbols)
    all_first_tx_sql = f"SELECT symbol, MIN(date) as first_tx_date FROM transactions WHERE symbol IN ({placeholders_all}) GROUP BY symbol"
    first_tx_dates_results = d1_query(all_first_tx_sql, symbols, api_key=D1_API_KEY)
    first_tx_dates = {row['symbol']: row['first_tx_date'].split('T')[0] for row in first_tx_dates_results if row.get('first_tx_date')}
    print("查詢完成。")

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
            start_date = None
            
            if latest_date_str:
                # 【修改】這裡不再把今天的日期當作重新抓取的條件，因為即時更新會處理
                if latest_date_str >= today_str:
                    start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
                else:
                    start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
            else:
                start_date = first_tx_dates.get(symbol, "2000-01-01")
            
            if start_date > today_str:
                print(f"{symbol} 的歷史數據已是最新 ({latest_date_str})，無需更新。")
                continue

            start_dates[symbol] = start_date
            symbols_to_fetch.append(symbol)

        if not symbols_to_fetch:
            print("此批次所有標的歷史數據都已是最新，跳過抓取。")
            continue

        print(f"準備從 yfinance 併發抓取 {len(symbols_to_fetch)} 筆歷史數據...")
        try:
            # 【修改】此處的 interval 仍然是 "1d"，專門用來抓取日線歷史數據
            data = yf.download(tickers=symbols_to_fetch, start=min(start_dates.values()), interval="1d", auto_adjust=False, back_adjust=False, progress=False)
            if data.empty:
                print("yfinance 沒有回傳任何新的歷史數據。")
                continue
            
            print(f"成功抓取到歷史數據，共 {len(data)} 筆時間紀錄。")
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
                    print(f"在 {start_dates[symbol]} 之後沒有找到 {symbol} 的新歷史數據。")
                    continue
                
                price_rows = symbol_data[['Close']].reset_index()
                for _, row in price_rows.iterrows():
                    db_ops_upsert.append({"sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;", "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Close']]})
                
                if not is_fx and 'Dividends' in symbol_data.columns:
                    dividend_rows = symbol_data[symbol_data['Dividends'] > 0][['Dividends']].reset_index()
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
        
        except Exception as e:
            print(f"處理歷史數據批次 {batch} 時發生錯誤: {e}")
            print("5 秒後繼續處理下一個批次...")
            time.sleep(5)
            
    # --- 【新增】在歷史數據更新完畢後，執行盤中即時價格更新 ---
    latest_prices = fetch_intraday_prices(symbols)
    if latest_prices:
        intraday_db_ops = []
        today_str = datetime.now().strftime('%Y-%m-%d')
        for symbol, price in latest_prices.items():
            # 使用 ON CONFLICT ... DO UPDATE 來插入或更新當天的價格
            sql = "INSERT INTO price_history (symbol, date, price) VALUES (?, ?, ?) ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;"
            intraday_db_ops.append({"sql": sql, "params": [symbol, today_str, price]})
        
        if intraday_db_ops:
            print(f"準備將 {len(intraday_db_ops)} 筆盤中價格寫入資料庫...")
            if d1_batch(intraday_db_ops, api_key=D1_API_KEY):
                print("成功將盤中最新價格更新至資料庫！")
            else:
                print("FATAL: 寫入盤中價格失敗！")

def trigger_recalculations(uids):
    """觸發所有使用者的後端重算"""
    # ... (此函式維持不變) ...
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
    print(f"--- 開始執行每日市場數據增量更新腳本 (v4.4 - 混合模式) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    update_symbols, all_uids = get_update_targets()
    if update_symbols:
        fetch_and_append_market_data(update_symbols)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        print("資料庫中沒有找到任何需要更新的標的。")
    print(f"--- 每日市場數據增量更新腳本執行完畢 --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
