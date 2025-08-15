import os
import yfinance as yf
import requests
import json
import logging
from datetime import datetime, timedelta
import time
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
import multiprocessing

# =========================================================================================
# == Python 每日增量更新腳本 完整程式碼 (v3.5 - 單檔優化版)
# =========================================================================================

# --- Logging 設定 ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# --- 從環境變數讀取設定 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY = os.environ.get("D1_API_KEY")
GCP_API_URL = os.environ.get("GCP_API_URL")
GCP_API_KEY = D1_API_KEY
SERVICE_ACCOUNT_KEY = os.environ.get("SERVICE_ACCOUNT_KEY")

# --- D1 API ---
def d1_query(sql, params=None, retries=3):
    if params is None:
        params = []
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    for attempt in range(retries):
        try:
            response = requests.post(f"{D1_WORKER_URL}/query", json={"sql": sql, "params": params}, headers=headers, timeout=15)
            response.raise_for_status()
            return response.json().get('results', [])
        except requests.exceptions.RequestException as e:
            logger.warning(f"D1 查詢失敗 (嘗試 {attempt+1}/{retries}): {e}")
            if attempt < retries - 1:
                time.sleep(3 * (attempt+1))
    return None

def d1_batch(statements, retries=3):
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    for attempt in range(retries):
        try:
            response = requests.post(f"{D1_WORKER_URL}/batch", json={"statements": statements}, headers=headers, timeout=30)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.warning(f"D1 批次操作失敗 (嘗試 {attempt+1}/{retries}): {e}")
            if attempt < retries - 1:
                time.sleep(3 * (attempt+1))
    return False

# --- 資料抓取對象 ---
def get_update_targets():
    logger.info("獲取需要更新的金融商品列表...")
    all_symbols = set()
    currency_to_fx = {"USD": "TWD=X", "HKD": "HKDTWD=X", "JPY": "JPYTWD=X"}

    # 1. 用戶持股
    holdings_results = d1_query("SELECT DISTINCT symbol, currency FROM holdings")
    if holdings_results:
        for row in holdings_results:
            all_symbols.add(row['symbol'])
            if row.get('currency') in currency_to_fx:
                all_symbols.add(currency_to_fx[row['currency']])

    # 2. Benchmark
    benchmark_results = d1_query("SELECT DISTINCT value AS symbol FROM controls WHERE key = 'benchmarkSymbol'")
    if benchmark_results:
        for row in benchmark_results:
            all_symbols.add(row['symbol'])

    symbols_list = list(all_symbols)

    # 3. 活躍使用者
    uid_results = d1_query("SELECT DISTINCT uid FROM transactions")
    uids = [row['uid'] for row in uid_results if row.get('uid')] if uid_results else []

    logger.info(f"共找到 {len(symbols_list)} 個標的, {len(uids)} 位使用者")
    return symbols_list, uids

# --- 批量查詢最新日期 & 首次交易日期 ---
def get_dates_from_d1(symbols):
    latest_dates = {}
    first_tx_dates = {}

    if not symbols:
        return latest_dates, first_tx_dates

    symbol_params = ','.join(['?'] * len(symbols))

    # 最新日期查詢
    sql_latest = f"""
        SELECT symbol, MAX(date) as latest_date FROM (
            SELECT symbol, date FROM price_history WHERE symbol IN ({symbol_params})
            UNION ALL
            SELECT symbol, date FROM exchange_rates WHERE symbol IN ({symbol_params})
        )
        GROUP BY symbol
    """
    results_latest = d1_query(sql_latest, symbols + symbols)
    if results_latest:
        for row in results_latest:
            if row.get('latest_date'):
                latest_dates[row['symbol']] = row['latest_date'].split('T')[0]

    # 首次交易日期查詢
    sql_first_tx = f"SELECT symbol, MIN(date) as first_tx_date FROM transactions WHERE symbol IN ({symbol_params}) GROUP BY symbol"
    results_first = d1_query(sql_first_tx, symbols)
    if results_first:
        for row in results_first:
            if row.get('first_tx_date'):
                first_tx_dates[row['symbol']] = row['first_tx_date'].split('T')[0]

    return latest_dates, first_tx_dates

# --- 單標的處理 ---
def process_single_symbol(symbol, today_str, latest_dates, first_tx_dates):
    if not symbol:
        return None

    is_fx = "=" in symbol
    price_table = "exchange_rates" if is_fx else "price_history"
    price_staging_table = "exchange_rates_staging" if is_fx else "price_history_staging"
    dividend_staging_table = "dividend_history_staging"

    latest_date_str = latest_dates.get(symbol)
    if not latest_date_str:
        start_date = first_tx_dates.get(symbol, "2000-01-01")
    else:
        start_date = (datetime.strptime(latest_date_str, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')

    if start_date > today_str:
        d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
        return None

    try:
        stock = yf.Ticker(symbol)
        hist = stock.history(
            start=start_date,
            end=(datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d'),
            interval="1d",
            auto_adjust=False,
            back_adjust=False
        )

        if hist.empty:
            d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
            return None

        db_ops_staging = [{"sql": f"DELETE FROM {price_staging_table} WHERE symbol = ?", "params": [symbol]}]
        if not is_fx:
            db_ops_staging.append({"sql": f"DELETE FROM {dividend_staging_table} WHERE symbol = ?", "params": [symbol]})

        for idx, row in hist.iterrows():
            date_str = idx.strftime('%Y-%m-%d')
            if pd.notna(row['Close']):
                db_ops_staging.append({
                    "sql": f"INSERT INTO {price_staging_table} (symbol, date, price) VALUES (?, ?, ?)",
                    "params": [symbol, date_str, row['Close']]
                })
            if not is_fx and row.get('Dividends', 0) > 0:
                db_ops_staging.append({
                    "sql": f"INSERT INTO {dividend_staging_table} (symbol, date, dividend) VALUES (?, ?, ?)",
                    "params": [symbol, date_str, row['Dividends']]
                })

        if not d1_batch(db_ops_staging):
            return None

        db_ops_upsert = [{
            "sql": f"""
                INSERT INTO {price_table} (symbol, date, price)
                SELECT symbol, date, price FROM {price_staging_table} WHERE symbol = ?
                ON CONFLICT(symbol, date) DO UPDATE SET price = excluded.price;
            """,
            "params": [symbol]
        }]

        if not is_fx:
            db_ops_upsert.append({
                "sql": """
                    INSERT INTO dividend_history (symbol, date, dividend)
                    SELECT symbol, date, dividend FROM dividend_history_staging WHERE symbol = ?
                    ON CONFLICT(symbol, date) DO UPDATE SET dividend = excluded.dividend;
                """,
                "params": [symbol]
            })

        if d1_batch(db_ops_upsert):
            d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?", [today_str, symbol])
            return symbol
        return None

    except Exception as e:
        logger.error(f"{symbol} 更新失敗: {e}")
        return None

# --- 並行更新 ---
def fetch_and_append_market_data(symbols):
    if not symbols:
        logger.info("沒有需要更新的標的。")
        return

    today_str = datetime.now().strftime('%Y-%m-%d')
    latest_dates, first_tx_dates = get_dates_from_d1(symbols)

    max_workers = min(len(symbols), multiprocessing.cpu_count() * 2)
    logger.info(f"使用 {max_workers} 個並行工作者處理 {len(symbols)} 個標的...")

    success_count = fail_count = skip_count = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_single_symbol, s, today_str, latest_dates, first_tx_dates): s for s in symbols}
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                result = future.result()
                if result:
                    logger.info(f"{symbol} 更新完成")
                    success_count += 1
                else:
                    skip_count += 1
            except Exception as exc:
                logger.error(f"{symbol} 處理時例外: {exc}")
                fail_count += 1

    logger.info(f"更新完成: 成功 {success_count}, 跳過 {skip_count}, 失敗 {fail_count}")

# --- 觸發重算 ---
def trigger_recalculations(uids):
    if not uids:
        logger.info("沒有需要觸發重算的使用者。")
        return
    if not GCP_API_URL or not GCP_API_KEY or not SERVICE_ACCOUNT_KEY:
        logger.warning("缺少 GCP_API_URL / GCP_API_KEY / SERVICE_ACCOUNT_KEY，跳過觸發重算。")
        return

    headers = {
        'X-API-KEY': GCP_API_KEY,
        'Content-Type': 'application/json',
        'X-Service-Account-Key': SERVICE_ACCOUNT_KEY
    }
    try:
        payload = {"action": "recalculate_all_users"}
        response = requests.post(GCP_API_URL, json=payload, headers=headers)
        if response.status_code == 200:
            logger.info("成功觸發全部使用者重算。")
        else:
            logger.error(f"觸發重算失敗: {response.status_code} - {response.text}")
    except Exception as e:
        logger.error(f"觸發重算時錯誤: {e}")

# --- 主流程 ---
if __name__ == "__main__":
    logger.info(f"=== 開始執行每日市場數據增量更新腳本 (v3.5 單檔優化版) ===")
    update_symbols, all_uids = get_update_targets()
    if update_symbols:
        fetch_and_append_market_data(update_symbols)
        if all_uids:
            trigger_recalculations(all_uids)
    else:
        logger.info("資料庫中沒有找到任何需要更新的標的。")
    logger.info("=== 腳本執行完畢 ===")
