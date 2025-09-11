import yfinance as yf
import os

# ===============================================================
# ==  yfinance 獨立診斷腳本
# ===============================================================
# 說明：
# 此腳本專門用來測試 yfinance 套件是否能從 GitHub Actions 環境
# 成功抓取 Yahoo Finance 的公開資料。
# 它會嘗試抓取幾支有代表性的股票，並印出結果。
# ===============================================================

# 股票代碼列表 (包含了美股、ETF、台股)
SYMBOLS_TO_TEST = [
    'AAPL',  # Apple Inc. (美股)
    'VOO',   # Vanguard S&P 500 ETF (美股ETF)
    '0050.TW' # 元大台灣50 (台股ETF)
]

print("===================================================")
print("== 開始執行 yfinance 功能診斷測試 ==")
print(f"== yfinance 套件版本: {yf.__version__} ==")
print("===================================================\n")

has_errors = False

for symbol in SYMBOLS_TO_TEST:
    print(f"--- 正在嘗試抓取 [{symbol}] 的配息資料 ---")
    try:
        ticker = yf.Ticker(symbol)
        
        # .dividends 會回傳一個 Pandas DataFrame
        dividends = ticker.dividends
        
        # 檢查回傳的 DataFrame 是否為空
        if not dividends.empty:
            print(f"[成功] 成功抓取到 {symbol} 的配-息資料！")
            # .tail(3) 印出最近的 3 筆資料
            print("最近 3 筆配息紀錄:")
            print(dividends.tail(3))
        else:
            # 這種情況比較少見，但可能代表該股票無配息歷史
            print(f"[注意] 無法抓取到 {symbol} 的配息資料，回傳為空。")
            
    except Exception as e:
        # 任何在抓取過程中發生的錯誤都會被捕捉
        print(f"[錯誤] 抓取 {symbol} 過程中發生嚴重錯誤: {e}")
        has_errors = True
    
    print("-" * 40 + "\n")


print("===================================================")
if has_errors:
    print("== 診斷完成：測試過程中發現錯誤。 ==")
else:
    print("== 診斷完成：所有測試股票均成功執行。 ==")
print("===================================================")
