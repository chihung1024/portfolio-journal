import os
import json
import time
from datetime import datetime

import yfinance as yf
import pandas as pd
import requests
from google.oauth2 import service_account          # ← 取得 ID-Token 用
from google.auth.transport.requests import Request # ← 取得 ID-Token 用

# =========================================================================================
# == Python 週末完整校驗腳本 (v1.1 - Firebase Token 版)
# =========================================================================================

# --- 環境變數 ---
D1_WORKER_URL = os.environ.get("D1_WORKER_URL")
D1_API_KEY    = os.environ.get("D1_API_KEY")

GCP_API_URL   = os.environ.get("GCP_API_URL")      # ex: https://asia-east1-proj.cloudfunctions.net/unifiedPortfolioHandler
GCP_API_KEY   = D1_API_KEY                         # 第一道 API-Key 防線沿用
GCP_SA_JSON   = os.environ.get("GCP_SA_JSON")      # 服務帳戶 JSON（完整字串）

# -----------------------------------------------------------------------------------------

def get_id_token(sa_json_str: str, target_audience: str) -> str:
    """使用 Service-Account JSON 兌換 Cloud Function 專屬 OIDC ID-Token"""
    creds = service_account.IDTokenCredentials.from_service_account_info(
        json.loads(sa_json_str),
        target_audience=target_audience
    )
    creds.refresh(Request())
    return creds.token


# ----------------------------- D1 通用存取 -------------------------------------------------
def d1_query(sql, params=None):
    if params is None:
        params = []
    if not D1_WORKER_URL or not D1_API_KEY:
        print("FATAL: 缺少 D1_WORKER_URL 或 D1_API_KEY。")
        return None
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        resp = requests.post(f"{D1_WORKER_URL}/query",
                             json={"sql": sql, "params": params},
                             headers=headers)
        resp.raise_for_status()
        return resp.json().get('results', [])
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 查詢失敗: {e}")
        return None


def d1_batch(statements):
    """批次執行多條 SQL"""
    if not D1_WORKER_URL or not D1_API_KEY:
        print("FATAL: 缺少 D1_WORKER_URL 或 D1_API_KEY。")
        return False
    headers = {'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json'}
    try:
        resp = requests.post(f"{D1_WORKER_URL}/batch",
                             json={"statements": statements},
                             headers=headers)
        resp.raise_for_status()
        return True
    except requests.exceptions.RequestException as e:
        print(f"FATAL: D1 批次操作失敗: {e}")
        return False


# ----------------------------- 市場資料 -----------------------------------------------------
def get_full_refresh_targets():
    """抓需要完整刷新之標的與活躍使用者"""
    print("正在從 D1 獲取所有需要完整刷新的金融商品列表...")
    targets = d1_query("SELECT symbol, earliest_date FROM market_data_coverage")
    if targets is None:
        return [], []
    uids = [r['uid'] for r in d1_query("SELECT DISTINCT uid FROM transactions") if r.get('uid')]
    print(f"找到 {len(targets)} 個需完整刷新的標的。")
    print(f"找到 {len(uids)} 位活躍使用者: {uids}")
    return targets, uids


def fetch_and_overwrite_market_data(targets):
    if not targets:
        print("沒有需要刷新的標的。")
        return
    today_str = datetime.now().strftime('%Y-%m-%d')

    for tgt in targets:
        symbol, start_date = tgt.get('symbol'), tgt.get('earliest_date')
        if not symbol or not start_date:
            continue
        print(f"--- 正在處理完整刷新: {symbol} (從 {start_date} 開始) ---")

        is_fx      = "=" in symbol
        price_tbl  = "exchange_rates" if is_fx else "price_history"
        max_retry  = 3

        for attempt in range(1, max_retry + 1):
            try:
                hist = yf.Ticker(symbol).history(start=start_date, interval="1d",
                                                 auto_adjust=False, back_adjust=False)
                if hist.empty:
                    print(f"警告: 找不到 {symbol} 的歷史數據。")
                    break

                print(f"成功抓取到 {len(hist)} 筆 {symbol} 歷史數據。")

                ops = [{"sql": f"DELETE FROM {price_tbl} WHERE symbol = ?", "params": [symbol]}]
                if not is_fx:
                    ops.append({"sql": "DELETE FROM dividend_history WHERE symbol = ?", "params": [symbol]})

                for idx, row in hist.iterrows():
                    date_str = idx.strftime('%Y-%m-%d')
                    if pd.notna(row['Close']):
                        ops.append({"sql": f"INSERT INTO {price_tbl} (symbol, date, price) VALUES (?,?,?)",
                                    "params": [symbol, date_str, row['Close']]})
                    if not is_fx and row.get('Dividends', 0) > 0:
                        ops.append({"sql": "INSERT INTO dividend_history (symbol, date, dividend) VALUES (?,?,?)",
                                    "params": [symbol, date_str, row['Dividends']]})

                if d1_batch(ops):
                    print(f"成功覆蓋 {symbol} 的數據到 D1。")
                    d1_query("UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?",
                             [today_str, symbol])
                else:
                    print(f"ERROR: 覆蓋 {symbol} 到 D1 失敗。")
                break
            except Exception as e:
                print(f"ERROR attempt {attempt}/{max_retry} for {symbol}: {e}")
                if attempt < max_retry:
                    print("5 秒後重試...")
                    time.sleep(5)


# ----------------------------- 觸發重算 -----------------------------------------------------
def trigger_recalculations(uids):
    if not uids:
        print("沒有找到需要觸發重算的使用者。")
        return
    if not (GCP_API_URL and GCP_API_KEY and GCP_SA_JSON):
        print("警告: 缺少 GCP_API_URL / GCP_API_KEY / GCP_SA_JSON，跳過觸發重算。")
        return

    print(f"\n--- 準備為 {len(uids)} 位使用者觸發重算 ---")
    try:
        id_token = get_id_token(GCP_SA_JSON, GCP_API_URL)
    except Exception as e:
        print(f"FATAL: 無法取得 ID-Token：{e}")
        return

    headers = {
        'X-API-KEY': GCP_API_KEY,
        'Authorization': f'Bearer {id_token}',
        'Content-Type': 'application/json'
    }

    for uid in uids:
        try:
            resp = requests.post(GCP_API_URL,
                                 json={"action": "recalculate", "uid": uid},
                                 headers=headers)
            if resp.status_code == 200:
                print(f"成功觸發重算: uid {uid}")
            else:
                print(f"觸發失敗 uid {uid} → {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"觸發 uid {uid} 時出錯: {e}")
        time.sleep(1)  # 避免連續打爆 API


# ---------------------------------- 主程式 -------------------------------------------------
if __name__ == "__main__":
    print(f"--- 週末市場數據完整校驗腳本啟動 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---")
    targets, uids = get_full_refresh_targets()

    if targets:
        fetch_and_overwrite_market_data(targets)
        trigger_recalculations(uids)
    else:
        print("market_data_coverage 表中沒有任何需要刷新的標的。")

    print("--- 週末市場數據完整校驗腳本結束 ---")
