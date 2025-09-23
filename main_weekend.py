# =========================================================================================
# == Python 週末完整校驗腳本 (v3.5 - Resilient Integrated)
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
                return None
            print(f"將在 {delay} 秒後重試...")
            time.sleep(delay)
# ========================= 【核心優化 A - 結束】 =========================


# ========================= 【核心強化 C - 開始】 =========================
# == 新增：數據驗證與修復模組，確保數據完整性
# =========================================================================================
def verify_and_repair_data(symbol: str, data: pd.DataFrame, start_date: str, end_date: str) -> pd.DataFrame:
    """
    驗證金融數據的連續性，並對缺失的交易日數據進行單點精準修復。

    :param symbol: 金融商品代碼。
    :param data: 從 yfinance 初步抓取的數據 DataFrame，索引應為日期。
    :param start_date: 預期的開始日期字串 ('YYYY-MM-DD')。
    :param end_date: 預期的結束日期字串 ('YYYY-MM-DD')。
    :return: 經過驗證與修復後的數據 DataFrame。
    """
    if data.empty:
        return data

    # 1. 產生預期的交易日曆 (使用 pandas 的 business day range)
    try:
        expected_dates = pd.bdate_range(start=start_date, end=end_date)
    except Exception as e:
        print(f"警告: 為 {symbol} 產生預期日期範圍 ({start_date} to {end_date}) 時出錯: {e}。跳過驗證。")
        return data

    # 2. 找出實際已有的日期，並確保時區資訊一致 (naive)
    if not isinstance(data.index, pd.DatetimeIndex):
        data.index = pd.to_datetime(data.index)
    existing_dates = data.index.tz_localize(None)

    # 3. 透過集合運算，高效計算出缺失的日期
    missing_dates = expected_dates.difference(existing_dates)

    if not missing_dates.empty:
        print(f"[{symbol}] 發現 {len(missing_dates)} 個缺失的交易日。準備進行單點修復...")
        repaired_data_list = []
        
        # 4. 迭代所有缺失日期，進行高精準度的單點數據請求
        for i, missing_date in enumerate(missing_dates):
            print(f"  -> 正在修復 {missing_date.strftime('%Y-%m-%d')} ({i+1}/{len(missing_dates)})...")
            try:
                # yfinance 抓取單一天數據時，end 日期需設為隔天
                start_of_day = missing_date.strftime('%Y-%m-%d')
                end_of_day = (missing_date + timedelta(days=1)).strftime('%Y-%m-%d')
                
                def repair_func():
                    return yf.download(symbol, start=start_of_day, end=end_of_day, progress=False, auto_adjust=False, back_adjust=False)
                
                # 使用帶有重試機制的請求，但重試次數和延遲可以更保守
                repair_df = robust_request(repair_func, max_retries=2, delay=3, name=f"Repair {symbol} on {start_of_day}")

                if repair_df is not None and not repair_df.empty:
                    repaired_data_list.append(repair_df)
                
                # 尊重 API，每次修復請求後都進行短暫延遲，避免觸發速率限制
                time.sleep(0.5)

            except Exception as e:
                print(f"  -> 修復 {missing_date.strftime('%Y-%m-%d')} 時發生未預期錯誤: {e}")
        
        if repaired_data_list:
            # 5. 合併原始數據與所有成功修復的數據
            repaired_df_full = pd.concat(repaired_data_list)
            data = pd.concat([data, repaired_df_full]).sort_index()
            # 移除可能因合併操作產生的重複索引，保留第一個
            data = data[~data.index.duplicated(keep='first')]
            print(f"[{symbol}] 修復完成！新增 {len(repaired_data_list)} 筆數據。")

    return data
# ========================= 【核心強化 C - 結束】 =========================


def d1_query(sql, params=None):
    if params is None:
        params = []
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    
    # 【優化】使用 robust_request 進行網路請求
    def query_func():
        response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json().get('results', [])
        
    results = robust_request(query_func, name=f"D1 Query ({sql[:20]}...)")
    return results if results is not None else []

def d1_batch(statements):
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    
    # 【優化】使用 robust_request 進行網路請求
    def batch_func():
        response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": statements}, headers=headers, timeout=120) # 週末批次操作較大，增加超時
        response.raise_for_status()
        return True

    success = robust_request(batch_func, name=f"D1 Batch ({len(statements)} statements)")
    return success if success is not None else False


def get_full_refresh_targets():
    """全面獲取更新目標，並包含全局最早的交易日期"""
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

    date_range_result = d1_query("SELECT MIN(date) as earliest_date FROM transactions")
    global_earliest_tx_date = None
    if date_range_result and date_range_result[0].get('earliest_date'):
        global_earliest_tx_date = date_range_result[0]['earliest_date'].split('T')[0]
        print(f"找到全局最早的交易日期: {global_earliest_tx_date}")
    else:
        print("警告: 找不到任何交易紀錄。")

    print(f"找到 {len(targets)} 個需全面刷新的標的: {targets}")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    
    return targets, benchmark_symbols, uids, global_earliest_tx_date


# ========================= 【核心優化 B - 開始】 =========================
# == 修改：採用「原子性替換」策略，並整合「驗證與修復」機制
# =========================================================================================
def fetch_and_overwrite_market_data(targets, benchmark_symbols, global_earliest_tx_date, batch_size=5): # 調降批次大小
    if not targets:
        print("沒有需要刷新的標的。")
        return False # 【修正】回傳狀態

    print("步驟 1/5: 正在一次性查詢所有股票的交易狀態...")
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
    print("查詢完成。")

    print("\n步驟 2/5: 正在初始化臨時數據表...")
    # Cloudflare D1 不支援 `CREATE TABLE LIKE`，所以我們手動定義結構
    # 同時，先清除上一次可能遺留的舊表和臨時表，確保一個乾淨的開始
    init_statements = [
        {"sql": "DROP TABLE IF EXISTS price_history_old;"},
        {"sql": "DROP TABLE IF EXISTS dividend_history_old;"},
        {"sql": "DROP TABLE IF EXISTS exchange_rates_old;"},
        {"sql": "DROP TABLE IF EXISTS price_history_temp;"},
        {"sql": "DROP TABLE IF EXISTS dividend_history_temp;"},
        {"sql": "DROP TABLE IF EXISTS exchange_rates_temp;"},
        {"sql": "CREATE TABLE price_history_temp (symbol TEXT, date TEXT, price REAL, PRIMARY KEY(symbol, date));"},
        {"sql": "CREATE TABLE dividend_history_temp (symbol TEXT, date TEXT, dividend REAL, PRIMARY KEY(symbol, date));"},
        {"sql": "CREATE TABLE exchange_rates_temp (symbol TEXT, date TEXT, price REAL, PRIMARY KEY(symbol, date));"},
    ]
    if not d1_batch(init_statements):
        print("FATAL: 初始化臨時數據表失敗，腳本終止。")
        return False # 【修正】回傳狀態
    print("臨時表初始化成功。")


    print("\n步驟 3/5: 開始分批次抓取 **價格** 數據並寫入臨時表...")
    today_str = datetime.now().strftime('%Y-%m-%d')
    symbol_batches = [targets[i:i + batch_size] for i in range(0, len(targets), batch_size)]

    all_symbols_successfully_processed = []
    # 【整合關鍵】建立一個字典來儲存每個 symbol 的交易期間，供後續的股利過濾使用
    symbol_date_ranges = {}

    for i, batch in enumerate(symbol_batches):
        print(f"\n--- 正在處理價格刷新批次 {i+1}/{len(symbol_batches)}: {batch} ---")
        
        start_dates, end_dates = {}, {}
        symbols_to_fetch_in_batch = []
        
        for symbol in batch:
            is_fx = "=" in symbol
            is_benchmark = symbol in benchmark_symbols
            start_date, end_date = None, today_str
            
            if is_benchmark or is_fx:
                start_date = global_earliest_tx_date
            else:
                info = all_symbols_info.get(symbol)
                if info and info.get('earliest_date'):
                    start_date = info['earliest_date'].split('T')[0]
                    net_quantity = info.get('net_quantity')
                    if net_quantity is not None and net_quantity <= 1e-9:
                        end_date = info['last_tx_date'].split('T')[0]
                        print(f"資訊: {symbol} 已完全出清，數據迄日設為 {end_date}")
            
            if not start_date:
                print(f"警告: 找不到 {symbol} 的有效起始日期。跳過此標的。")
                continue
                
            start_dates[symbol] = start_date
            end_dates[symbol] = end_date
            # 【整合關鍵】儲存日期範圍
            symbol_date_ranges[symbol] = {'start': start_date, 'end': end_date}
            symbols_to_fetch_in_batch.append(symbol)

        if not symbols_to_fetch_in_batch:
            print("此批次所有標的都無需抓取。")
            continue
            
        latest_end_date_in_batch = max(end_dates.values())
        end_date_for_fetch = (datetime.strptime(latest_end_date_in_batch, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')

        print(f"準備從 yfinance 併發抓取數據 (迄日: {latest_end_date_in_batch})...")
        
        def yf_full_historical_func():
            return yf.download(
                tickers=symbols_to_fetch_in_batch,
                start=min(start_dates.values()),
                end=end_date_for_fetch,
                interval="1d",
                auto_adjust=False,
                back_adjust=False,
                progress=False
            )
        
        data = robust_request(yf_full_historical_func, name="YFinance Full Historical Download")
        if data is None or data.empty:
            print(f"警告: yfinance 沒有為批次 {batch} 回傳任何數據。跳過此批次。")
            continue

        print(f"成功抓取到數據，共 {len(data)} 筆時間紀錄。將開始逐一驗證與處理...")
        
        db_ops_to_temp = []
        
        for symbol in symbols_to_fetch_in_batch:
            symbol_data = pd.DataFrame() 

            if isinstance(data.columns, pd.MultiIndex):
                try:
                    symbol_data = data.loc[:, (slice(None), symbol)]
                    symbol_data.columns = symbol_data.columns.droplevel(1)
                except KeyError:
                    print(f"警告: 在 yfinance 回傳的多層級數據中找不到 {symbol} 的資料。")
                    continue
            elif len(symbols_to_fetch_in_batch) == 1:
                symbol_data = data
            else:
                print(f"警告: 為 {len(symbols_to_fetch_in_batch)} 個標的請求數據，但 yfinance 返回了無法識別的單一格式。")
                continue

            if symbol_data.empty or 'Close' not in symbol_data.columns:
                print(f"警告: {symbol} 在 yfinance 的回傳數據中無效或缺乏 'Close' 欄位。")
                continue
            
            symbol_data = symbol_data.dropna(subset=['Close'])
            symbol_data_filtered = symbol_data[(symbol_data.index >= pd.to_datetime(start_dates[symbol])) & (symbol_data.index <= pd.to_datetime(end_dates[symbol]))]

            if symbol_data_filtered.empty:
                print(f"警告: {symbol} 在其指定的日期範圍內沒有有效數據，跳過驗證步驟。")
                continue
            
            # 【整合驗證與修復】
            print(f"對 [{symbol}] 執行數據完整性驗證 ({start_dates[symbol]} to {end_dates[symbol]})...")
            symbol_data_verified = verify_and_repair_data(symbol, symbol_data_filtered, start_dates[symbol], end_dates[symbol])

            if symbol_data_verified.empty:
                print(f"警告: {symbol} 即使經過修復，在其日期範圍內仍無有效數據。")
                continue
            
            is_fx = "=" in symbol
            price_table = "exchange_rates_temp" if is_fx else "price_history_temp"
            
            price_rows = symbol_data_verified[['Close']].reset_index()
            for _, row in price_rows.iterrows():
                db_ops_to_temp.append({ "sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?)", "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row['Close']]})
            
            all_symbols_successfully_processed.append(symbol)

        if db_ops_to_temp:
            print(f"正在為批次 {batch} 準備 {len(db_ops_to_temp)} 筆價格數據寫入臨時表...")
            if not d1_batch(db_ops_to_temp):
                print(f"FATAL: 將批次 {batch} 數據寫入臨時表失敗！腳本終止。")
                return False # 【修正】回傳狀態
        
        # 批次處理結束後，增加延遲以尊重API
        print(f"批次 {i+1} 處理完畢，延遲 2 秒...")
        time.sleep(2)

    # ========================= 【全新整合的獨立、過濾後股利抓取步驟 - 開始】 =========================
    print("\n步驟 4/5: 開始獨立、逐一抓取並 **過濾** **股利** 數據...")
    dividend_ops_to_temp = []
    # 過濾掉匯率代碼，只處理股票
    stock_targets = [s for s in targets if "=" not in s]
    
    for i, symbol in enumerate(stock_targets):
        print(f"  -> ({i+1}/{len(stock_targets)}) 正在獨立查詢 [{symbol}] 的完整配息歷史...")
        
        # 從先前儲存的字典中獲取此 symbol 的交易起訖日
        date_range = symbol_date_ranges.get(symbol)
        if not date_range:
            print(f"  -> [錯誤] 找不到 {symbol} 的日期範圍資訊，跳過股利查詢。")
            continue

        start_date = date_range['start']
        end_date = date_range['end']

        try:
            # 1. 使用最可靠的方法：抓取完整的股利歷史
            ticker = yf.Ticker(symbol)
            dividends = ticker.dividends
            
            if dividends.empty:
                print(f"  -> [資訊] {symbol} 沒有任何歷史配息紀錄。")
                continue

            # 2. 【整合核心】根據交易週期進行過濾
            # 將索引轉為 timezone-naive 以便和字串日期比較
            dividends.index = dividends.index.tz_localize(None)
            filtered_dividends = dividends[(dividends.index >= pd.to_datetime(start_date)) & (dividends.index <= pd.to_datetime(end_date))]
            
            # 3. 處理過濾後的結果
            if not filtered_dividends.empty:
                dividend_rows = filtered_dividends[filtered_dividends > 0].reset_index()
                if not dividend_rows.empty:
                    print(f"  -> [成功] 找到 {symbol} 在交易期間內 ({start_date} to {end_date}) 的 {len(dividend_rows)} 筆配息紀錄。")
                    for _, row in dividend_rows.iterrows():
                        dividend_ops_to_temp.append({
                            "sql": "INSERT INTO dividend_history_temp (symbol, date, dividend) VALUES (?, ?, ?)",
                            "params": [symbol, row['Date'].strftime('%Y-%m-%d'), row.iloc[1]] # 使用 .iloc[1] 來安全地獲取第二欄 (股利值)
                        })
                else:
                    print(f"  -> [注意] {symbol} 在交易期間內的配息紀錄值均為零或負數。")
            else:
                print(f"  -> [注意] {symbol} 在其交易期間 ({start_date} to {end_date}) 內無配息。")
            
            time.sleep(1) # 股利查詢也加入延遲

        except Exception as e:
            # 捕捉任何可能的錯誤，印出訊息後繼續處理下一個
            print(f"  -> [錯誤] 查詢 {symbol} 配息時發生問題: {e}")

    if dividend_ops_to_temp:
        print(f"\n正在準備將 {len(dividend_ops_to_temp)} 筆股利數據寫入臨時表...")
        if not d1_batch(dividend_ops_to_temp):
            print(f"FATAL: 將股利數據寫入臨時表失敗！腳本終止。")
            return False
    else:
        print("\n未找到任何需要更新的股利數據。")
    # ========================= 【全新整合的獨立、過濾後股利抓取步驟 - 結束】 =========================
    
    print("\n步驟 5/5: 所有數據已寫入臨時表，準備執行原子性替換...")
    
    swap_statements = [
        {"sql": "ALTER TABLE price_history RENAME TO price_history_old;"},
        {"sql": "ALTER TABLE price_history_temp RENAME TO price_history;"},
        {"sql": "ALTER TABLE dividend_history RENAME TO dividend_history_old;"},
        {"sql": "ALTER TABLE dividend_history_temp RENAME TO dividend_history;"},
        {"sql": "ALTER TABLE exchange_rates RENAME TO exchange_rates_old;"},
        {"sql": "ALTER TABLE exchange_rates_temp RENAME TO exchange_rates;"},
    ]
    
    if d1_batch(swap_statements):
        print("成功！ 正式表數據已原子性更新。")
        
        # 更新覆蓋範圍元數據
        coverage_updates = []
        unique_processed_symbols = list(set(all_symbols_successfully_processed))
        placeholders = ','.join('?' for _ in unique_processed_symbols)
        
        all_first_tx_sql = f"SELECT symbol, MIN(date) as first_tx_date FROM transactions WHERE symbol IN ({placeholders}) GROUP BY symbol"
        first_tx_dates_results = d1_query(all_first_tx_sql, unique_processed_symbols)
        first_tx_dates = {row['symbol']: row['first_tx_date'].split('T')[0] for row in first_tx_dates_results if row.get('first_tx_date')}

        for symbol in unique_processed_symbols:
            symbol_start_date = first_tx_dates.get(symbol, "2000-01-01")
            if symbol_start_date:
                coverage_updates.append({
                    "sql": "INSERT OR REPLACE INTO market_data_coverage (symbol, earliest_date, last_updated) VALUES (?, ?, ?)",
                    "params": [symbol, symbol_start_date, today_str]
                })
        
        if coverage_updates:
            print("正在更新 market_data_coverage 狀態...")
            if not d1_batch(coverage_updates):
                print(f"警告: 更新 market_data_coverage 狀態失敗。")
        
        print("正在清理舊的數據表...")
        cleanup_statements = [
            {"sql": "DROP TABLE IF EXISTS price_history_old;"},
            {"sql": "DROP TABLE IF EXISTS dividend_history_old;"},
            {"sql": "DROP TABLE IF EXISTS exchange_rates_old;"}
        ]
        d1_batch(cleanup_statements)
        return True # 【修正】回傳狀態
    else:
        print(f"FATAL: 原子性替換數據失敗！資料庫可能處於不一致狀態，請手動檢查。")
        return False # 【修正】回傳狀態

# ========================= 【核心優化 B - 結束】 =========================


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
    headers = {'X-API-KEY': GCP_API_KEY, 'Content-Type': 'application/json', 'X-Service-Account-Key': SERVICE_ACCOUNT_KEY}
    
    def trigger_func():
        payload = {"action": "recalculate_all_users", "createSnapshot": True}
        response = requests.post(GCP_API_URL, json=payload, headers=headers, timeout=60)
        response.raise_for_status()
        return response

    response = robust_request(trigger_func, name="Trigger Recalculations with Snapshot")
    if response and response.status_code == 200:
        print(f"成功觸發所有使用者的重算與快照建立。")
    elif response:
        print(f"觸發重算失敗. 狀態碼: {response.status_code}, 回應: {response.text}")
    else:
        print("觸發重算最終失敗。")


if __name__ == "__main__":
    print(f"--- 開始執行週末市場數據完整校驗腳本 (v3.5 - Resilient Integrated) --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    refresh_targets, benchmark_symbols, all_uids, global_start_date = get_full_refresh_targets()
    if refresh_targets:
        # 【核心修正】檢查數據刷新是否成功
        success = fetch_and_overwrite_market_data(refresh_targets, benchmark_symbols, global_start_date)
        
        if success:
            print("\n--- 【全局快取失效階段】偵測到價格數據已成功刷新，正在將所有群組標記為 dirty... ---")
            invalidate_sql = "UPDATE groups SET is_dirty = 1"
            if d1_batch([{"sql": invalidate_sql, "params": []}]):
                print("成功！所有自訂群組的快取都已被標記為需要重新計算。")
            else:
                print("FATAL: 全局快取失效操作失敗！")
            
            if all_uids:
                trigger_recalculations(all_uids)
        else:
            print("\n--- 【終止】由於市場數據刷新失敗，已跳過後續的快取失效與重算步驟，以確保數據一致性。 ---")

    else:
        print("資料庫中沒有找到任何需要刷新的標的 (無持股、無Benchmark)。")
    print(f"--- 週末市場數據完整校驗腳本執行完畢 --- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
