import yfinance as yf

# 換成一個您確定有配息的股票代碼，例如蘋果或VOO
symbol = 'AAPL' 

print(f"正在嘗試抓取 {symbol} 的配息資料...")

try:
    ticker = yf.Ticker(symbol)
    dividends = ticker.dividends

    if not dividends.empty:
        print(f"成功抓取到 {symbol} 的配息資料！")
        # 印出最近5筆
        print(dividends.tail(5))
    else:
        print(f"無法抓取到 {symbol} 的配息資料，回傳為空。")

except Exception as e:
    print(f"抓取過程中發生嚴重錯誤: {e}")
