import os
import json
import time
import math
import logging
import datetime
import requests
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed

# =========================
# 設定 Logging
# =========================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# =========================
# 設定參數
# =========================
VERSION = "v3.5 每5分鐘增量更新版"
D1_BASE_URL = os.getenv("D1_BASE_URL")
D1_AUTH_TOKEN = os.getenv("D1_AUTH_TOKEN")
MAX_RETRIES = 3
RETRY_DELAY = 3  # 秒
MAX_WORKERS = 8

# =========================
# D1 請求工具
# =========================
def d1_query(sql, params=None):
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.post(
                f"{D1_BASE_URL}/query",
                headers={"Authorization": f"Bearer {D1_AUTH_TOKEN}"},
                json={"sql": sql, "params": params or []},
                timeout=30
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.warning(f"D1 查詢失敗: {e}, 重試 {attempt+1}/{MAX_RETRIES}")
            time.sleep(RETRY_DELAY)
    raise RuntimeError("D1 查詢連續失敗")

def d1_batch(statements):
    for attempt in range(MAX_RETRIES):
        try:
            r = requests.post(
                f"{D1_BASE_URL}/batch",
                headers={"Authorization": f"Bearer {D1_AUTH_TOKEN}"},
                json={"statements": statements},
                timeout=60
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.warning(f"D1 批次失敗: {e}, 重試 {attempt+1}/{MAX_RETRIES}")
            time.sleep(RETRY_DELAY)
    raise RuntimeError("D1 批次連續失敗")

# =========================
# 取最新與首次交易日
# =========================
def get_latest_dates_from_d1(symbols):
    placeholders = ",".join("?" for _ in symbols)
    sql_price = f"SELECT symbol, MAX(date) AS latest_date FROM price_history WHERE symbol IN ({placeholders}) GROUP BY symbol"
    sql_fx = f"SELECT symbol, MAX(date) AS latest_date FROM exchange_rates WHERE symbol IN ({placeholders}) GROUP BY symbol"

    latest_dates = {}
    for sql in [sql_price, sql_fx]:
        res = d1_query(sql, symbols)
        for row in res.get("results", []):
            latest_dates[row["symbol"]] = row["latest_date"]
    return latest_dates

def get_first_tx_dates_from_d1(symbols):
    placeholders = ",".join("?" for _ in symbols)
    sql_price = f"SELECT symbol, MIN(date) AS first_date FROM price_history WHERE symbol IN ({placeholders}) GROUP BY symbol"
    sql_fx = f"SELECT symbol, MIN(date) AS first_date FROM exchange_rates WHERE symbol IN ({placeholders}) GROUP BY symbol"

    first_dates = {}
    for sql in [sql_price, sql_fx]:
        res = d1_query(sql, symbols)
        for row in res.get("results", []):
            first_dates[row["symbol"]] = row["first_date"]
    return first_dates

# =========================
# 單一標的處理
# =========================
def process_single_symbol(symbol, latest_dates, first_tx_dates, today_str):
    try:
        latest_date = latest_dates.get(symbol)
        if latest_date:
            if latest_date < today_str:
                start_date = (datetime.datetime.strptime(latest_date, "%Y-%m-%d") + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
            else:
                # 最新日期是今天 → 強制從今天開始抓，覆蓋當天
                start_date = today_str
        else:
            first_date = first_tx_dates.get(symbol)
            if first_date:
                start_date = first_date
            else:
                logger.warning(f"{symbol}: 無首次交易日期，跳過")
                return None

        # 抓取結束日期多加一天
        end_date = (datetime.datetime.strptime(today_str, "%Y-%m-%d") + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

        data = yf.download(symbol, start=start_date, end=end_date, progress=False, interval="1d")
        if data.empty:
            logger.info(f"{symbol}: {start_date} - {end_date} 無新數據")
            return "skipped"

        data.reset_index(inplace=True)
        statements = []
        for _, row in data.iterrows():
            trade_date = row['Date'].strftime("%Y-%m-%d")
            if "Close" in row:
                statements.append({
                    "sql": """
                        INSERT OR REPLACE INTO price_history
                        (symbol, date, open, high, low, close, volume)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    "params": [
                        symbol, trade_date,
                        float(row["Open"]) if not math.isnan(row["Open"]) else None,
                        float(row["High"]) if not math.isnan(row["High"]) else None,
                        float(row["Low"]) if not math.isnan(row["Low"]) else None,
                        float(row["Close"]) if not math.isnan(row["Close"]) else None,
                        int(row["Volume"]) if not math.isnan(row["Volume"]) else None
                    ]
                })
            elif "Rate" in row:
                statements.append({
                    "sql": """
                        INSERT OR REPLACE INTO exchange_rates
                        (symbol, date, rate)
                        VALUES (?, ?, ?)
                    """,
                    "params": [
                        symbol, trade_date,
                        float(row["Rate"]) if not math.isnan(row["Rate"]) else None
                    ]
                })

        if statements:
            d1_batch(statements)
            logger.info(f"{symbol}: 更新 {len(statements)} 筆記錄")
            return "success"
        else:
            logger.info(f"{symbol}: 無可更新記錄")
            return "skipped"

    except Exception as e:
        logger.error(f"{symbol}: 更新失敗 → {e}")
        return "failed"

# =========================
# 觸發使用者重算
# =========================
def trigger_recalc_for_users(uids):
    statements = []
    for uid in uids:
        statements.append({
            "sql": "UPDATE users SET needs_recalc = 1 WHERE uid = ?",
            "params": [uid]
        })
    if statements:
        d1_batch(statements)
        logger.info("成功觸發全部使用者重算。")

# =========================
# 主程式
# =========================
def main():
    logger.info(f"=== 開始執行每日市場數據增量更新腳本 ({VERSION}) ===")

    # 取得需要更新的 symbols 與使用者
    logger.info("獲取需要更新的金融商品列表...")
    res = d1_query("SELECT DISTINCT symbol, uid FROM market_data_coverage")
    symbols = [row["symbol"] for row in res.get("results", [])]
    uids = list({row["uid"] for row in res.get("results", [])})
    logger.info(f"共找到 {len(symbols)} 個標的, {len(uids)} 位使用者")

    today_str = datetime.datetime.now().strftime("%Y-%m-%d")

    latest_dates = get_latest_dates_from_d1(symbols)
    first_tx_dates = get_first_tx_dates_from_d1(symbols)

    results = {"success": 0, "skipped": 0, "failed": 0}

    logger.info(f"使用 {MAX_WORKERS} 個並行工作者處理 {len(symbols)} 個標的...")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_symbol = {
            executor.submit(process_single_symbol, symbol, latest_dates, first_tx_dates, today_str): symbol
            for symbol in symbols
        }
        for future in as_completed(future_to_symbol):
            result = future.result()
            if result in results:
                results[result] += 1

    logger.info(f"更新完成: 成功 {results['success']}, 跳過 {results['skipped']}, 失敗 {results['failed']}")

    if results["success"] > 0:
        trigger_recalc_for_users(uids)

    logger.info("=== 腳本執行完畢 ===")

if __name__ == "__main__":
    main()
