import os
import time
import json
import logging
from datetime import datetime
from typing import List, Dict, Any, Iterable

import requests
import yfinance as yf
import pandas as pd

# =========================================================================================
# == Python 週末完整校驗腳本 完整程式碼 (v1.0 - 完整覆蓋版)
# =========================================================================================

# -------------------------------------------------
# 1️⃣  設定 Logging
# -------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# -------------------------------------------------
# 2️⃣  讀取環境變數
# -------------------------------------------------
D1_WORKER_URL   = os.getenv("D1_WORKER_URL")
D1_API_KEY      = os.getenv("D1_API_KEY")
GCP_API_URL     = os.getenv("GCP_API_URL")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")   # 只給 GCP 重算服務的金鑰

if not D1_WORKER_URL or not D1_API_KEY:
    raise RuntimeError("必須設定 D1_WORKER_URL 以及 D1_API_KEY")
if not GCP_API_URL:
    raise RuntimeError("必須設定 GCP_API_URL")
if not INTERNAL_API_KEY:
    raise RuntimeError("必須設定 INTERNAL_API_KEY (GitHub Actions secret)")

# -------------------------------------------------
# 3️⃣  D1 的通用查詢 / 批次函式
# -------------------------------------------------
def d1_query(sql: str, params: List[Any] = None) -> List[Dict[str, Any]]:
    """向 D1_worker /query 發送 SQL，回傳結果陣列（list of dict）"""
    if params is None:
        params = []
    headers = {"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"}
    try:
        resp = requests.post(
            f"{D1_WORKER_URL}/query",
            json={"sql": sql, "params": params},
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("results", [])
    except requests.RequestException as exc:
        log.error("D1 query 失敗: %s", exc, exc_info=True)
        return []

def d1_batch(statements: List[Dict[str, Any]]) -> bool:
    """向 D1_worker /batch 實作多筆 SQL，回傳成功/失敗布林值"""
    headers = {"X-API-KEY": D1_API_KEY, "Content-Type": "application/json"}
    try:
        resp = requests.post(
            f"{D1_WORKER_URL}/batch",
            json={"statements": statements},
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        return True
    except requests.RequestException as exc:
        log.error("D1 batch 失敗: %s", exc, exc_info=True)
        return False

# -------------------------------------------------
# 4️⃣  取得需要完整刷新的標的與活躍 uid
# -------------------------------------------------
def get_full_refresh_targets() -> (List[Dict[str, Any]], List[int]):
    """回傳兩個列表：<br> 1. market_data_coverage 中的 {symbol, earliest_date} <br> 2. 所有活躍使用者 uid"""
    log.info("從 market_data_coverage 取得刷新目標...")
    # 1️⃣ 取得標的
    sql_targets = "SELECT symbol, earliest_date FROM market_data_coverage"
    targets = d1_query(sql_targets)

    # 2️⃣ 取得活躍 uid（distinct）
    sql_uids = "SELECT DISTINCT uid FROM transactions"
    uid_rows = d1_query(sql_uids)
    uids = [row["uid"] for row in uid_rows if row.get("uid")]

    log.info("找到 %d 個需完整刷新的標的", len(targets))
    log.info("找到 %d 位活躍使用者", len(uids))
    return targets, uids

# -------------------------------------------------
# 5️⃣  抓取歷史資料、覆寫 D1
# -------------------------------------------------
def fetch_and_overwrite_market_data(targets: List[Dict[str, Any]]) -> None:
    """針對每支標的抓取完整歷史，刪除舊資料、插入新資料"""
    if not targets:
        log.warning("沒有需要刷新的標的")
        return

    today_str = datetime.now().strftime("%Y-%m-%d")

    for target in targets:
        symbol = target.get("symbol")
        start_date = target.get("earliest_date")
        if not symbol or not start_date:
            continue

        log.info("--- 正在刷新 %s (自 %s) ---", symbol, start_date)

        is_fx = "=" in symbol                    # 簡易判斷是否為外匯 (symbol 內有 = 符號)
        price_table = "exchange_rates" if is_fx else "price_history"

        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                ticker = yf.Ticker(symbol)
                hist = ticker.history(
                    start=start_date,
                    interval="1d",
                    auto_adjust=False,
                    back_adjust=False,
                )
                if hist.empty:
                    log.warning("找不到 %s 從 %s 起的資料，跳過", symbol, start_date)
                    break

                log.info("抓到 %d 筆 %s 歷史資料", len(hist), symbol)

                # ---------- 準備 SQL ----------
                ops: List[Dict[str, Any]] = []

                # 刪除舊資料
                ops.append(
                    {"sql": f"DELETE FROM {price_table} WHERE symbol = ?", "params": [symbol]}
                )
                if not is_fx:
                    ops.append({"sql": "DELETE FROM dividend_history WHERE symbol = ?", "params": [symbol]})

                # 插入新資料
                for dt, row in hist.iterrows():
                    date_str = dt.strftime("%Y-%m-%d")
                    if pd.notna(row["Close"]):
                        ops.append(
                            {
                                "sql": f"INSERT INTO {price_table} (symbol, date, price) VALUES (?, ?, ?)",
                                "params": [symbol, date_str, float(row["Close"])],
                            }
                        )
                    # 若是股票且有股息
                    if not is_fx and row.get("Dividends", 0) > 0:
                        ops.append(
                            {
                                "sql": "INSERT INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)",
                                "params": [symbol, date_str, float(row["Dividends"])],
                            }
                        )

                # 執行批次
                if d1_batch(ops):
                    log.info("成功覆蓋 %s 的資料到 D1", symbol)
                else:
                    log.error("覆寫 %s 到 D1 失敗", symbol)

                # 更新 market_data_coverage 的 last_updated
                d1_query(
                    "UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?",
                    [today_str, symbol],
                )
                # 若成功，直接跳出 retry 迴圈
                break

            except Exception as exc:
                log.exception("第 %d 次嘗試抓取 %s 時發生例外", attempt, symbol)
                if attempt < max_retries:
                    log.info("5 秒後重試...")
                    time.sleep(5)
                else:
                    log.error("連續 %d 次抓取失敗，放棄 %s", max_retries, symbol)

# -------------------------------------------------
# 6️⃣  單筆觸發重新計算 (debug 建議)
# -------------------------------------------------
def trigger_recalculation(uid: str) -> bool:
    """向 GCP Cloud Function 觸發單筆使用者的投資組合重新計算"""
    if not uid:
        log.warning("uid 為空，跳過")
        return False

    payload = {
        "action": "recalculate",
        "data": {"uid": uid},
    }
    headers = {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_API_KEY,
    }

    try:
        resp = requests.post(GCP_API_URL, json=payload, headers=headers, timeout=10)
        if resp.status_code == 200:
            log.info("✅ 成功觸發 UID %s 的重算", uid)
            return True
        else:
            log.warning(
                "❌ 觸發重算失敗: uid=%s, status=%s, body=%s",
                uid,
                resp.status_code,
                resp.text,
            )
            return False
    except requests.RequestException as exc:
        log.error("🚨 請求例外 (uid=%s): %s", uid, exc, exc_info=True)
        return False

# -------------------------------------------------
# 7️⃣  批次呼叫（遍歷版）
# -------------------------------------------------
def trigger_recalculations(uids: Iterable[str]) -> None:
    """遍歷 all_uids，對每筆呼叫 trigger_recalculation 並統計結果"""
    if not uids:
        log.info("沒有使用者需要觸發重算")
        return

    uids = list(uids)  # 讓我們可以取得長度、做 index 判斷
    log.info("=== 準備為 %d 位使用者觸發重算 ===", len(uids))

    success, failed = 0, 0
    for idx, uid in enumerate(uids, start=1):
        if trigger_recalculation(uid):
            success += 1
        else:
            failed += 1

        # 防止短時間內發太多請求（保留原本的 1 秒間隔）
        if idx < len(uids):
            time.sleep(1)

    log.info("=== 觸發完畢：成功 %d / 失敗 %d ===", success, failed)

# -------------------------------------------------
# 8️⃣  程式入口
# -------------------------------------------------
if __name__ == "__main__":
    log.info("=== 開始執行週末市場資料完整校驗腳本 (v1.0) ===")
    refresh_targets, all_uids = get_full_refresh_targets()

    if refresh_targets:
        fetch_and_overwrite_market_data(refresh_targets)
        trigger_recalculations(all_uids)
    else:
        log.info("market_data_coverage 表中沒有需要刷新的標的")

    log.info("=== 週末市場資料完整校驗腳本執行結束 ===")
