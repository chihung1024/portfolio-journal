# quote_server.py
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import os

app = Flask(__name__)
CORS(app) # 允許來自您前端網域的跨域請求

# 從環境變數讀取 IBKR Gateway 的位址
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:5000")

def get_ibkr_market_data(symbols_str):
    """向 IBKR Gateway 查詢市場快照數據"""
    # 使用 /md/snapshot 端點，欄位 31 代表最後價 (Last Price)
    # 更多欄位代碼可查詢 IBKR API 文件
    endpoint = f"{GATEWAY_URL}/v1/api/md/snapshot"
    params = {'conids': '', 'fields': '31,70,71', 'symbols': symbols_str} # 31=最後價, 70=買價, 71=賣價
    
    try:
        # 關閉 SSL 驗證，因為是與本地 Gateway 通訊
        response = requests.get(endpoint, params=params, verify=False, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        quotes = {}
        for item in data:
            # 嘗試從回傳數據中找到股票代碼，這可能需要根據實際回傳格式微調
            symbol = item.get('conid_ticker', item.get('symbol', str(item.get('conid'))))
            price = item.get('31_i') # 31_i 通常是最後價
            
            if symbol and price:
                quotes[symbol] = {'price': float(price)}
        return quotes, None
    except Exception as e:
        print(f"Error fetching from IBKR Gateway: {e}")
        return None, str(e)

@app.route('/api/live-prices', methods=['GET'])
def live_prices():
    symbols = request.args.get('symbols')
    if not symbols:
        return jsonify({"error": "Missing 'symbols' query parameter"}), 400
    
    quotes, error = get_ibkr_market_data(symbols)
    
    if error:
        return jsonify({"error": f"Gateway communication error: {error}"}), 503 # Service Unavailable
        
    return jsonify(quotes)

if __name__ == '__main__':
    # 在 Docker 容器中，host='0.0.0.0' 讓它可以被外部訪問
    app.run(host='0.0.0.0', port=5001)
