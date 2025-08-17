# =========================================================================================
# == Python 週末完整校驗與股票池更新腳本 (v3.0 - 整合版)
# =========================================================================================
import os
import yfinance as yf
import requests
import json
from datetime import datetime, timedelta
import time
import pandas as pd
from concurrent.futures import ThreadPoolExecutor

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
# [修正] GCP_API_KEY 應與 D1_API_KEY 相同
GCP_API_KEY = D1_API_KEY
# [新增] 用於多執行緒的並行數量
MAX_WORKERS = 15


# =========================================================================================
# == D1 資料庫通訊模組 (維持不變)
# =========================================================================================
def d1_query(sql, params=None):
    if params is None:
        params = []
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers, timeout=60)
        response.raise_for_status()
        return response.json().get('results', [])
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return []

def d1_batch(statements):
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": statements}, headers=headers, timeout=180)
        response.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False

# =========================================================================================
# == [新增] 股票池 (Universe) 更新模組
# == 邏輯移植自 back_test/update_data.py 並加以優化
# =========================================================================================
def get_sp500_from_wiki() -> list[str]:
    """備援方案：從維基百科抓取 S&P 500 成分股"""
    try:
        print("INFO: 正在嘗試從 Wikipedia 獲取 S&P 500 成分股...")
        url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
        # [注意] pd.read_html 需要 lxml 套件
        table = pd.read_html(url)
        sp500_df = table[0]
        # 將 symbol 中的 "." 替換為 "-", 例如 "BRK.B" -> "BRK-B"
        return sp500_df['Symbol'].str.replace('.', '-', regex=False).tolist()
    except Exception as e:
        print(f"ERROR: 從 Wikipedia 獲取 S&P 500 失敗: {e}")
        return []

def get_nasdaq100_from_wiki() -> list[str]:
    """備援方案：從維基百科抓取 NASDAQ 100 成分股"""
    try:
        print("INFO: 正在嘗試從 Wikipedia 獲取 NASDAQ 100 成分股...")
        url = "https://en.wikipedia.org/wiki/Nasdaq-100"
        table = pd.read_html(url)
        # 通常是第 4 個表格
        nasdaq100_df = table[4]
        return nasdaq100_df['Ticker'].tolist()
    except Exception as e:
        print(f"ERROR: 從 Wikipedia 獲取 NASDAQ 100 失敗: {e}")
        return []

def fetch_ticker_metadata(ticker: str):
    """抓取單一股票的元數據 (市值、產業)"""
    try:
        info = yf.Ticker(ticker).info
        # 只有在市值存在時才認為是有效數據
        if info.get("marketCap") and info.get("marketCap") > 0:
            return {
                "symbol": ticker,
                "name": info.get("shortName"),
                "market_cap": info.get("marketCap"),
                "sector": info.get("sector"),
            }
        return None
    except Exception:
        # yfinance 對於無效 ticker 會拋出各種異常
        return None

def update_stock_universe():
    """主函式：更新股票池元數據"""
    print("\n--- [階段 1/3] 開始執行週末股票池元數據更新 ---")
    
    # 1. 獲取成分股列表
    sp500_tickers = get_sp500_from_wiki()
    nasdaq100_tickers = get_nasdaq100_from_wiki()
    
    if not sp500_tickers and not nasdaq100_tickers:
        print("FATAL: 無法從任何來源獲取指數成分股，中止元數據更新。")
        return

    # 合併並去重
    universe_tickers = sorted(list(set(sp500_tickers + nasdaq100_tickers)))
    print(f"INFO: 成功合併 S&P 500 與 NASDAQ 100，共計 {len(universe_tickers)} 支獨立股票。")

    # 2. 多執行緒並行抓取元數據
    all_metadata = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(fetch_ticker_metadata, ticker) for ticker in universe_tickers]
        
        # 使用 tqdm 顯示進度條
        from tqdm import tqdm
        for future in tqdm(futures, total=len(universe_tickers), desc="抓取元數據"):
            result = future.result()
            if result:
                all_metadata.append(result)

    print(f"INFO: 成功抓取到 {len(all_metadata)} 支股票的有效元數據。")

    if not all_metadata:
        print("WARNING: 未能抓取到任何有效的股票元數據，跳過資料庫更新。")
        return

    # 3. 準備資料庫操作
    db_ops = []
    today_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    sp500_set = set(sp500_tickers)
    nasdaq100_set = set(nasdaq100_tickers)

    for data in all_metadata:
        db_ops.append({
            "sql": """
                INSERT OR REPLACE INTO stock_universe_metadata 
                (symbol, name, market_cap, sector, in_sp500, in_nasdaq100, last_updated) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            "params": [
                data['symbol'],
                data.get('name'),
                data.get('market_cap'),
                data.get('sector'),
                (data['symbol'] in sp500_set),
                (data['symbol'] in nasdaq100_set),
                today_str
            ]
        })

    # 4. 批次寫入資料庫
    print(f"INFO: 準備將 {len(db_ops)} 筆元數據寫入 D1 資料庫...")
    if d1_batch(db_ops):
        print("SUCCESS: 股票池元數據已成功更新至 D1 資料庫！")
    else:
        print("FATAL: 批次寫入股票池元數據失敗！")
    print("--- [階段 1/3] 股票池元數據更新完成 ---\n")


# =========================================================================================
# == [既有功能] 市場價格數據完整校驗模組 (邏輯維持不變)
# =========================================================================================
def get_full_refresh_targets():
    """全面獲取更新目標，並包含全局最早的交易日期"""
    print("--- [階段 2/3] 開始執行市場價格數據完整校驗 ---")
    print("INFO: 正在全面獲取所有需要完整刷新的金融商品列表...")
    
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

    date_range_result = d1_query("SELECT MIN(date) as earliest_date FROM transactions")
    global_earliest_tx_date = None
    if date_range_result and date_range_result[0].get('earliest_date'):
        global_earliest_tx_date = date_range_result[0]['earliest_date'].split('T')[0]
        print(f"INFO: 找到全局最早的交易日期: {global_earliest_tx_date}")
    else:
        print("WARNING: 找不到任何交易紀錄。")

    print(f"INFO: 找到 {len(targets)} 個需全面刷新的標的: {targets}")
    print(f"INFO: 找到 {len(uids)} 位活躍使用者: {uids}")
    
    return targets, benchmark_symbols, uids, global_earliest_tx_date

def fetch_and_overwrite_market_data(targets, benchmark_symbols, global_earliest_tx_date, batch_size=10):
    if not targets:
        print("INFO: 沒有需要刷新的價格數據標的。")
        return

    print("INFO: 正在一次性查詢所有股票的交易狀態...")
    all_symbols_info_sql = """
        SELECT
            symbol,
            MIN(date) as earliest_date,
            MAX(date) as last_tx_date,
            SUM(CASE WHEN type = 'buy' THEN quantity ELSE -quantity END) as net_quantity
        FROM transactions
        GROUP BY symbol
    """
    all_symbols_info = {row['symbol']: row for row in d1_query(all_symbols_info_sql)}
    print("INFO: 交易狀態查詢完成。")

    today_str = datetime.now().strftime('%Y-%m-%d')
    symbol_batches = [targets[i:i + batch_size] for i in range(0, len(targets), batch_size)]

    for i, batch in enumerate(symbol_batches):
        print(f"\n--- 正在處理價格刷新批次 {i+1}/{len(symbol_batches)}: {batch} ---")
        
        start_dates = {}
        end_dates = {}
        symbols_to_fetch_in_batch = []
        
        for symbol in batch:
            is_fx = "=" in symbol
            is_benchmark = symbol in benchmark_symbols
            start_date = None
            end_date = today_str
            
            if is_benchmark or is_fx:
                start_date = global_earliest_tx_date
            else:
                info = all_symbols_info.get(symbol)
                if info and info.get('earliest_date'):
                    start_date = info['earliest_date'].split('T')[0]
                    net_quantity = info.get('net_quantity')
                    if net_quantity is not None and net_quantity <= 1e-9:
                        end_date = info['last_tx_date'].split('T')[0]
                        print(f"INFO: {symbol} 已完全出清，數據迄日設為 {end_date}")
            
            if not start_date:
                print(f"WARNING: 找不到 {symbol} 的有效起始日期。跳過此標的。")
                continue
                
            start_dates[symbol] = start_date
            end_dates[symbol] = end_date
            symbols_to_fetch_in_batch.append(symbol)

        if not symbols_to_fetch_in_batch:
            print("INFO: 此批次所有標的都無需抓取。")
            continue
            
        latest_end_date_in_batch = max(end_dates.values())
        end_date_for_fetch = (datetime.strptime(latest_end_date_in_batch, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')

        print(f"INFO: 準備從 yfinance 併發抓取數據 (迄日: {latest_end_date_in_batch})...")
        try:
            data = yf.download(
                tickers=symbols_to_fetch_in_batch,
                start=min(start_dates.values()),
                end=end_date_for_fetch,
                interval="1d",
                auto_adjust=False,
                back_adjust=False,
                progress=False
            )
            
            if data.empty:
                print("WARNING: yfinance 沒有回傳任何數據。")
                continue

            print(f"INFO: 成功抓取到數據，共 {len(data)} 筆時間紀錄。")
            
            db_ops_swap = []
            symbols_successfully_processed = []
            for symbol in symbols_to_fetch_in_batch:
                is_fx = "=" in symbol
                price_table = "exchange_rates" if is_fx else "price_history"
                dividend_table = "dividend_history"
                
                symbol_data = data.loc[:, data.columns.get_level_values(1)==symbol] if len(symbols_to_fetch_in_batch) > 1 else data
                if len(symbols_to_fetch_in_batch) > 1:
                    symbol_data.columns = symbol_data.columns.droplevel(1)
                
                if symbol_data.empty or ('Close' in symbol_data.columns and symbol_data['Close'].isnull().all()):
                    print(f"WARNING: {symbol} 在 yfinance 的回傳數據中無效或全為 NaN。跳過此標的。")
                    continue
                
                symbol_data = symbol_data.dropna(subset=['Close'])
                
                symbol_start_date = start_dates[symbol]
                symbol_end_date = end_dates[symbol]
                symbol_data = symbol_data[(symbol_data.index >= pd.to_datetime(symbol_start_date)) & (symbol_data.index <= pd.to_datetime(symbol_end_date))]

                if symbol_data.empty:
                    print(f"WARNING: {symbol} 在其指定的日期範圍 {symbol_start_date} ~ {symbol_end_date} 內沒有有效數據。")
                    continue
                
                db_ops_swap.append({"sql": f"DELETE FROM {price_table} WHERE symbol = ?", "params": [symbol]})
                if not is_fx:
                    db_ops_swap.append({"sql": f"DELETE FROM {dividend_table} WHERE symbol = ?", "params": [symbol]})

                price_rows = symbol_data[['Close']].reset_index()
                for _, row in price_rows.iterrows():
                    db_ops_swap.append({ "sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?)", "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Close']]})
                
                if not is_fx and 'Dividends' in symbol_data.columns:
                    dividend_rows = symbol_data[symbol_data['Dividends'] > 0][['Dividends']].reset_index()
                    for _, row in dividend_rows.iterrows():
                        db_ops_swap.append({"sql": f"INSERT INTO {dividend_table} (symbol, date, dividend) VALUES (?, ?, ?)", "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Dividends']]})
                
                symbols_successfully_processed.append(symbol)

            if db_ops_swap:
                print(f"INFO: 正在為批次 {batch} 準備 {len(db_ops_swap)} 筆資料庫覆蓋操作...")
                if d1_batch(db_ops_swap):
                    print(f"SUCCESS: 批次 {batch} 的價格數據已原子性更新。")
                    
                    coverage_updates = []
                    for symbol in symbols_successfully_processed:
                        symbol_start_date = start_dates.get(symbol)
                        if symbol_start_date:
                            coverage_updates.append({
                                "sql": "INSERT OR REPLACE INTO market_data_coverage (symbol, earliest_date, last_updated) VALUES (?, ?, ?)",
                                "params": [symbol, symbol_start_date, today_str]
                            })
                    
                    if coverage_updates and not d1_batch(coverage_updates):
                        print(f"WARNING: 更新批次 {batch} 的 market_data_coverage 狀態失敗。")
                else:
                    print(f"FATAL: 原子性替換批次 {batch} 的數據失敗！")

        except Exception as e:
            print(f"ERROR: 處理批次 {batch} 時發生錯誤: {e}")
            print("INFO: 5 秒後繼續處理下一個批次...")
            time.sleep(5)
    
    print("--- [階段 2/3] 市場價格數據完整校驗完成 ---\n")

# =========================================================================================
# == [既有功能] 觸發後端重算 (邏輯維持不變)
# =========================================================================================
def trigger_recalculations(uids):
    """觸發所有使用者的後端重算"""
    print("--- [階段 3/3] 開始觸發後端整體重算 ---")
    if not uids:
        print("INFO: 沒有找到需要觸發重算的使用者。")
        return
    if not GCP_API_URL or not GCP_API_KEY:
        print("WARNING: 缺少 GCP_API_URL 或 GCP_API_KEY，跳過觸發重算。")
        return
    
    print(f"INFO: 準備為 {len(uids)} 位使用者觸發重算 (包含建立快照指令)...")
    SERVICE_ACCOUNT_KEY = os.environ.get("SERVICE_ACCOUNT_KEY")
    if not SERVICE_ACCOUNT_KEY:
        print("FATAL: 缺少 SERVICE_ACCOUNT_KEY 環境變數，無法觸發重算。")
        return
        
    headers = {'X-API-KEY': GCP_API_KEY, 'Content-Type': 'application/json', 'X-Service-Account-Key': SERVICE_ACCOUNT_KEY}
    try:
        payload = {"action": "recalculate_all_users", "createSnapshot": True}
        response = requests.post(GCP_API_URL, json=payload, headers=headers, timeout=60)
        if response.status_code == 200:
            print(f"SUCCESS: 成功觸發所有使用者的重算與快照建立。")
        else:
            print(f"ERROR: 觸發重算失敗. 狀態碼: {response.status_code}, 回應: {response.text}")
    except Exception as e:
        print(f"FATAL: 觸發重算時發生錯誤: {e}")
    print("--- [階段 3/3] 後端整體重算觸發完成 ---")


# =========================================================================================
# == 主執行流程
# =========================================================================================
if __name__ == "__main__":
    start_time = time.time()
    print(f"--- 開始執行週末數據完整校驗與股票池更新腳本 (v3.0) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # 步驟 1: 更新股票池元數據
    update_stock_universe()
    
    # 步驟 2: 刷新所有使用者相關的價格數據
    refresh_targets, benchmark_symbols, all_uids, global_start_date = get_full_refresh_targets()
    if refresh_targets:
        fetch_and_overwrite_market_data(refresh_targets, benchmark_symbols, global_start_date)
        
        # 步驟 3: 在數據更新後，觸發所有使用者的後端重算
        if all_uids:
            trigger_recalculations(all_uids)
        else:
             print("INFO: 沒有活躍使用者，無需觸發後端重算。")
    else:
        print("INFO: 資料庫中沒有找到任何需要刷新的標的 (無持股、無Benchmark)。")
        
    end_time = time.time()
    print(f"--- 週末數據完整校驗與股票池更新腳本執行完畢 --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"--- 總耗時: {end_time - start_time:.2f} 秒 ---")
