# 專案提案：建構基於 Synology NAS 的 IBKR 即時數據服務

## 1. 專案目標 (Project Goal)

本提案旨在為「股票交易紀錄與資產分析系統」建立一個高效、穩定且具成本效益的即時數據更新模組。此模組將在美股開盤時段，以高頻率（建議每 5 秒）從 Interactive Brokers (IBKR) 獲取使用者持股的最新報價，並即時更新前端儀表板的相關「快照類數據」（如總資產、當日損益等），為使用者提供零延遲的看盤體驗。

## 2. 核心挑戰 (Core Challenge)

與公開的、無狀態的 Yahoo Finance API 不同，IBKR 作為專業級交易 API，其整合有兩大挑戰：
1.  **會話維持 (Persistent Session)**：IBKR API 需要一個**長時運行 (24/7)** 的「客戶端網關 (Client Portal Gateway)」來維持登入會話。
2.  **有狀態服務 (Stateful Service)**：這要求我們必須有一個不休眠的伺服器環境，這與 Google Cloud Functions 等無伺服器 (Serverless) 架構的設計理念相悖。

直接使用雲端無伺服器架構來應對此需求，將導致架構複雜且成本高昂。

## 3. 建議架構：本地即時數據中心 (Local Real-time Data Hub)

為解決上述挑戰並完美利用您現有的硬體資源，我們將採用**混合式架構**，將高頻率的即時數據請求**完全從雲端剝離**，轉移到您的 Synology NAS 上。

### 架構原則

* **職責分離**：**NAS 專職即時報價**，**雲端 (GCP/D1) 專職核心業務與數據持久化**。
* **負載本地化**：將每 5 秒一次的高頻率 API 請求負載，由您自己的 NAS 處理，**不對 GCP 產生任何成本**。
* **前端計算**：為追求極致的低延遲，最終的即時市值計算將在前端瀏覽器完成。

### 架構圖 (即時數據流)

```mermaid
graph TD
    subgraph "使用者端 (Browser)"
        A[前端應用<br>index.html]
    end

    subgraph "您的本地網路 (Synology NAS)"
        NAS_RP[反向代理 (SSL)]
        subgraph "Docker on NAS"
            QS[報價伺服器<br>quote_server.py]
            IBG[IBKR Gateway]
        end
    end
    
    subgraph "外部服務"
        CF[Cloudflare DNS]
        IBKR[IBKR Servers]
    end

    %% 流程定義
    A -- "1. [每5秒] 輪詢報價<br>GET /api/live-prices?symbols=..." --> CF;
    CF -- "2. api.yourdomain.com 指向 -><br>您的固定 IP" --> NAS_RP;
    NAS_RP -- "3. 轉發請求至容器" --> QS;
    QS -- "4. 查詢本地 Gateway" --> IBG;
    IBG -- "5. 與 IBKR 伺服器溝通" --> IBKR;
    IBKR -- "6. 回傳即時報價" --> IBG;
    IBG -- "7. 回傳" --> QS;
    QS -- "8. 將報價以 JSON 格式回傳" --> NAS_RP;
    NAS_RP -- "9. 回傳" --> CF;
    CF -- "10. 回傳" --> A;
    A -- "11. [在瀏覽器中] 計算市值<br>並更新 UI" --> A;```

## 4. 詳細工作流程 (Step-by-Step Workflow)

1.  **初始化**：使用者載入網頁，從 GCP/D1 獲取完整的歷史數據和**昨日收盤價**。
2.  **啟動輪詢**：前端 JavaScript 檢查當前是否為美股開盤時間，若是，則啟動一個每 5 秒執行一次的計時器。
3.  **前端請求**：計時器觸發時，前端收集當前持股的所有代碼，並向您的專屬網域 `https://ibkr-api.yourdomain.com/api/live-prices` 發送請求。
4.  **網路路由**：請求經由 Cloudflare DNS、您的固定 IP、路由器連接埠轉發、Synology 反向代理，最終安全地送達 NAS 上運行的「報價伺服器」容器。
5.  **NAS 處理**：「報價伺服器」 (`quote_server.py`) 收到請求後，向在本機運行的 IBKR Gateway 容器查詢即時價格。
6.  **數據返回**：IBKR Gateway 從 IBKR 主機獲取數據後，層層返回，最終前端會收到一個純淨的 JSON 格式報價數據。
7.  **前端計算與渲染**：前端利用這個 JSON 數據和已有的持股成本資訊，**在瀏覽器本地**快速重新計算最新的總資產、未實現損益、當日損益等「快照類數據」，並立即更新網頁畫面。

## 5. 所需資源與前置準備

* **硬體/網路 (您已具備)**
    * [x] Interactive Brokers 帳號
    * [x] Synology NAS (安裝並啟用 Container Manager)
    * [x] Cloudflare 託管的網域
    * [x] 家用網路的固定 IP

* **軟體與服務 (需要您設定)**
    * [ ] **IBKR 市場數據訂閱**：登入 IBKR 帳戶管理，確認已訂閱 API 所需的即時數據包。
    * [ ] **SSL 憑證**：透過 Synology「控制台」>「登入入口」>「憑證」，為您的 `ibkr-api.yourdomain.com` 申請免費的 Let's Encrypt 憑證。

## 6. 實作藍圖 (Implementation Blueprint)

### A. 報價伺服器 (`quote_server.py`) 完整範例

這是一個使用 Python 和 Flask 框架的輕量級 API 伺服器，請將其與對應的 `Dockerfile` 一同部署在 NAS 上。

```python
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
```

### B. 前端 `index.html` 輪詢邏輯

這是您前端新增的核心邏輯，負責在開盤時段發起輪詢並更新畫面。

```javascript
// 全域變數
let liveQuoteInterval = null;
let currentHoldings = {}; // 確保這個變數儲存了從 GCP 載入的持股數據

// 在 renderHoldingsTable 函式中，順便更新這個全域變數
function renderHoldingsTable(holdingsData) {
    currentHoldings = holdingsData;
    // ... 後續 render 邏輯不變
}

// 在 handleAuthentication 成功登入後呼叫此函式
function startLiveQuotePolling() {
    stopLiveQuotePolling(); // 先停止舊的，以防萬一
    
    const poll = async () => {
        // 檢查是否為美股開盤時間 (台灣時間約 21:30 - 04:00，此處為簡化判斷)
        const now = new Date();
        const taipeiHour = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Taipei"})).getHours();
        const isMarketOpen = (taipeiHour >= 21 || taipeiHour < 4);
        
        if (!isMarketOpen) return; // 非開盤時間則不執行

        const symbols = Object.keys(currentHoldings);
        if (symbols.length === 0) return;

        try {
            // 向您的 NAS 報價伺服器發送請求
            const response = await fetch(`https://ibkr-api.yourdomain.com/api/live-prices?symbols=${symbols.join(',')}`);
            if (!response.ok) throw new Error('Failed to fetch live quotes');
            
            const liveQuotes = await response.json();
            
            // 呼叫一個專門的函式來更新畫面
            updateUIWithLiveData(liveQuotes);
        } catch (e) {
            console.error("Polling for live quotes failed:", e);
        }
    };
    
    liveQuoteInterval = setInterval(poll, 5000); // 每 5 秒執行一次
    poll(); // 頁面載入後立即執行一次
}

function stopLiveQuotePolling() {
    if (liveQuoteInterval) {
        clearInterval(liveQuoteInterval);
        liveQuoteInterval = null;
    }
}

// 這個函式負責用新價格更新畫面
function updateUIWithLiveData(liveQuotes) {
    if (Object.keys(liveQuotes).length === 0) return;

    let totalMarketValue = 0;
    let totalUnrealizedPL = 0;
    const todayFxRate = marketDataForFrontend['TWD=X']?.rates[new Date().toISOString().split('T')[0]] || 32.5; // 簡易獲取當日匯率

    // 遍歷 currentHoldings，用 liveQuotes 的新價格來更新
    for (const symbol in currentHoldings) {
        const h = currentHoldings[symbol];
        const liveQuote = liveQuotes[symbol];
        
        const currentPrice = liveQuote?.price ?? h.currentPriceOriginal;
        const fx = h.currency === 'TWD' ? 1 : todayFxRate;

        const marketValueTWD = h.quantity * currentPrice * fx;
        const unrealizedPLTWD = marketValueTWD - h.totalCostTWD;
        
        // 更新 currentHoldings 物件中的值
        h.currentPriceOriginal = currentPrice;
        h.marketValueTWD = marketValueTWD;
        h.unrealizedPLTWD = unrealizedPLTWD;
        h.returnRate = h.totalCostTWD > 0 ? (unrealizedPLTWD / h.totalCostTWD) * 100 : 0;
        
        totalMarketValue += marketValueTWD;
        totalUnrealizedPL += unrealizedPLTWD;
    }

    // 使用更新後的 currentHoldings 重新渲染表格
    renderHoldingsTable(currentHoldings);

    // 更新儀表板上跟市值相關的數據
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);
    // ...以及更新未實現損益、當日損益等欄位...
}
```

## 7. 效益與優勢

* **極致效能**：即時數據流完全繞過雲端後端，實現了最低的網路延遲。
* **零雲端成本**：高頻率的輪詢對 GCP 和 D1 的帳單**影響為零**。
* **高穩定性**：核心交易系統 (GCP/D1) 與即時報價系統 (NAS) 物理分離。即使 NAS 或家中網路中斷，使用者依然可以正常查看所有歷史數據和執行交易，系統不會癱瘓。
* **可擴展性**：未來若有多位使用者，即時報價的負載將分散到每個使用者自己的 NAS 上，架構具備良好的橫向擴展潛力。

```
