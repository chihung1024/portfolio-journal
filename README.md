# 股票交易紀錄與資產分析系統 (Portfolio Journal & Analysis System) - v1.0

歡迎使用本系統！這是一個功能完整、架構穩健的網頁應用程式，旨在幫助使用者輕鬆紀錄股票交易、追蹤投資組合表現，並透過專業的指標（如時間加權報酬率 TWR、XIRR）進行深入的績效分析。

##  主要功能 (Key Features)

- **👤 使用者認證系統**：基於 Firebase Authentication，提供安全可靠的使用者註冊、登入與登出功能，確保每個使用者的資料各自獨立、隱私不受侵犯。
- **📊 儀表板總覽**：登入後立即顯示關鍵績效指標(KPI)，包含總資產、已實現/未實現損益、總報酬率及 XIRR 年化報酬率。
- **📈 互動式圖表**：
    - **資產成長曲線**：視覺化呈現總資產隨時間變化的趨勢。
    - **TWR vs. Benchmark**：將您的時間加權報酬率與自選的市場基準（如 SPY）進行對比，評估您的超額報酬。
- **📂 詳盡的投資組合管理**：
    - **持股一覽**：即時顯示每項持股的數量、平均成本、總成本、現價、市值、損益與報酬率。
    - **交易紀錄**：完整記錄每一筆買入、賣出交易的詳細資訊。
    - **拆股事件管理**：支援股票分割/合併事件的紀錄與自動計算。
- **🔄 自動化數據同步**：
    - **自動刷新**：登入後，前端頁面會定時自動從後端同步最新數據，無需手動整理。
    - **每日維護**：後端每日自動化執行腳本，確保所有市場歷史數據（股價、匯率、股息）的完整與準確。

## 技術架構 (Technical Architecture)

本專案採用前後端分離的現代化網頁架構，各元件職責分明，具備高安全性與高可擴展性。

| 元件 | 技術/服務 | 職責 |
| --- | --- | --- |
| **前端 (Frontend)** | `index.html` (HTML, JS, Tailwind CSS) | UI/UX、使用者認證、API 請求、畫面渲染 |
| **後端 API (Backend API)** | Google Cloud Function (`index.js`, Node.js) | API 閘道、安全驗證、核心投資組合計算 |
| **資料庫 (Database)** | Cloudflare D1 (SQLite-based) | 儲存所有使用者資料與市場歷史數據 |
| **每日維護 (Maintenance)** | Python Script (`main.py`) | 每日批次抓取市場數據、觸發全局重算 |
| **第三方服務** | Firebase Authentication, Yahoo Finance | 提供使用者認證、市場數據來源 |

### 架構串連與工作流程

```mermaid
graph TD
    subgraph "使用者端 (Client-Side)"
        A[使用者 Browser] -- 操作/瀏覽 --> B[前端應用<br>(index.html)];
    end

    subgraph "Google Cloud Platform (GCP)"
        D[Cloud Function<br>後端 API (index.js)]
    end
    
    subgraph "Cloudflare Platform"
        E[D1 Worker API<br>(資料庫代理)] --> F[Cloudflare D1<br>資料庫];
        H[排程工具<br>(如 Cloud Scheduler)]
    end

    subgraph "Python 執行環境"
        I[Python 腳本<br>(main.py)]
    end

    subgraph "第三方服務 (3rd Party Services)"
        C[Firebase Authentication];
        G[Yahoo Finance API];
    end

    %% 流程定義
    B -- "1. 登入/註冊" --> C;
    C -- "2. 回傳令牌" --> B;
    B -- "3. API 請求 (攜令牌)" --> D;
    D -- "4. 驗證令牌" --> C;
    D -- "5. 核心計算" --> D;
    D -- "6. 讀寫資料庫" --> E;
    E -- "7. 執行 SQL" --> F;
    F -- "8. 回傳數據" --> E;
    E -- "9. 回傳數據" --> D;
    D -- "10. 回傳結果" --> B;
    B -- "11. 渲染UI畫面" --> A;

    H -- "1a. 每日定時觸發" --> I;
    I -- "2a. 讀取需更新列表" --> E;
    I -- "3a. 抓取歷史數據" --> G;
    I -- "4a. 寫入歷史數據" --> E;
    I -- "5a. 觸發全局重算" --> D;
```

#### 工作流程詳解：
1.  **使用者認證與資料載入**：
    - 使用者在前端 `index.html` 輸入帳號密碼，前端透過 Firebase SDK 將請求發送至 **Firebase Authentication**。
    - 認證成功後，Firebase 返回一個 JWT 認證令牌給前端。
    - 前端在後續所有對後端 API 的請求中，都會在標頭 (Header) 附上此令牌。
    - 後端 `index.js` 收到請求後，會先用 Firebase Admin SDK 驗證令牌的有效性，確保請求合法。
    - 驗證通過後，後端從 D1 資料庫讀取該使用者的數據，執行計算，並將結果返回給前端。前端頁面也會定時自動執行此流程來刷新數據。

2.  **交易管理**：
    - 使用者在前端新增、編輯或刪除一筆交易。
    - 前端發送對應的 `action`（如 `add_transaction`）請求給後端。
    - 後端驗證令牌後，執行對資料庫的寫入操作，然後**自動觸發一次完整的 `performRecalculation`**，重新計算該使用者的所有數據並寫入資料庫。
    - 前端在收到成功回應後，會再次請求最新數據 (`loadPortfolioData`) 來刷新畫面。

3.  **每日自動化維護**：
    - **Cloud Scheduler** 等排程工具在每日的指定時間，自動觸發執行 **Python 腳本 (`main.py`)**。
    - 腳本向 D1 資料庫查詢所有使用者正在關注的標的（持股與 Benchmark）。
    - 腳本透過 `yfinance` 向 **Yahoo Finance API** 請求這些標的所需範圍內的歷史價格與股息數據。
    - 腳本將抓取到的新數據批次寫入 D1 資料庫，完成數據的每日校準。
    - 最後，腳本會向後端 API 發送請求，為所有使用者觸發一次重新計算，確保他們的總覽數據與最新的市場數據同步。

## 使用者體驗 (User Experience - UX)

- **無縫的登入體驗**：支援記住登入狀態，使用者再次開啟網頁時會看到載入動畫並直接進入主畫面，無需反覆輸入帳號密碼。
- **直觀的數據呈現**：透過儀表板和圖表，讓複雜的投資數據一目了然。
- **即時的操作回饋**：所有需要等待後端處理的操作（如儲存交易）都會有讀取動畫，並在完成後跳出成功或失敗的提示訊息。
- **自動化刷新機制**：登入後，前端會定時自動從後端同步最新數據，確保資訊的即時性。
- **響應式設計**：基於 Tailwind CSS，確保在桌面和行動裝置上都有良好的瀏覽體驗。

## 管理者維護 (Administrator Maintenance)

作為此專案的擁有者和維護者，您需要關注以下幾點：

1.  **環境變數設定**：
    - **後端 (Google Cloud Function)**：需設定 `D1_WORKER_URL` 和 `D1_API_KEY`，使其能與您的 D1 資料庫代理通訊。
    - **Python 腳本**：需設定 `D1_WORKER_URL`, `D1_API_KEY` 和 `GCP_API_URL`，使其能同時與資料庫和後端 API 溝通。

2.  **前端設定**：
    - `index.html` 中的 `firebaseConfig` 物件必須設定為您自己的 Firebase 專案憑證。
    - `API.URL` 和 `API.KEY` 必須與您的後端服務部署位置和金鑰一致。

3.  **每日維護腳本排程**：
    - 您需要將 `main.py` 腳本部署到一個可以定時執行的環境（如 Google Cloud Run, GitHub Actions, 或任何支援 cron job 的伺服器）。
    - 並設定排程器（如 Google Cloud Scheduler）來每日自動觸發此腳本。

4.  **資料庫管理**：
    - 您可以隨時登入 Cloudflare Dashboard 進入 **D1 Studio**，手動查詢或修改資料庫內容。
    - 如需完全重置測試環境，可以使用預先準備好的 `DELETE FROM ...` 腳本來清空所有資料表。

5.  **監控與除錯**：
    - **前端問題**：在瀏覽器的「開發人員工具 (Developer Tools)」的主控台 (Console) 中查看錯誤訊息。
    - **後端問題**：在 Google Cloud Function 的「日誌 (Logs)」頁面中，查看 `console.log` 的輸出和任何運行時錯誤。

## 未來展望 (Future Roadmap)

- 支援更多資產類別（如加密貨幣、基金）。
- 提供更豐富的圖表與數據分析維度。
- 產生可匯出的 PDF 或 CSV 績效報告。
- 優化行動裝置上的操作體驗。
- 整合更多數據來源，減少對單一 API 的依賴。
