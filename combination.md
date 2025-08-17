# **專案報告：建構一站式個人量化投資平台**

**版本**: 2.0 (最終定稿)
**日期**: 2025-08-17
**狀態**: 已定稿，待批准後執行

## **1. 執行摘要 (Executive Summary)**

本報告旨在提出一個全面的技術方案，將現有的 `portfolio-journal`（一個基於真實交易紀錄的投資組合分析工具）與 `back_test`（一個策略回測與掃描工具）進行深度整合與架構升級。

我們將摒棄簡單的功能拼接，轉而採用「**大一統 (Great Unification)**」的核心理念。此理念將**策略回測**抽象化為對一套\*\*「模擬生成的交易事件」**的分析。透過建立一個能夠處理任何事件流（無論真實或模擬）的**通用計算引擎 (Universal Calculation Engine)\*\*，我們將完美地融合兩個專案的功能，最終打造一個功能強大、架構優雅、且易於長期維護的一站式個人量化投資平台。

此計畫不僅僅是功能的疊加，更是一次徹底的架構重塑，旨在為使用者提供從**真實資產追蹤**到**未來策略探索**的無縫體驗。

## **2. 專案目標 (Project Goals)**

  * **功能整合**: 在單一應用程式內，提供真實投資組合分析、彈性策略回測、大規模個股掃描與篩選三大核心功能。
  * **架構統一**: 將後端計算邏輯完全遷移至 Node.js (Google Cloud Functions)，前端 UI/UX 保持一致，移除 `back_test` 專案的 Python/Vercel 依賴。
  * **數據中台化**: 建立以 Cloudflare D1 為核心的統一數據中台，實現市場數據的「隨需獲取、永久快取」，讓數據池能根據使用者需求智慧成長。
  * **高效能與高可靠性**: 針對大規模計算任務（如個股掃描），引入非同步任務隊列 (Google Cloud Tasks)，規避 Serverless 架構的超時風險，確保系統的穩定性與擴展性。
  * **卓越使用者體驗**: 透過前端虛擬化渲染等技術，確保即使在處理大規模數據時，介面依然保持流暢與響應迅速。

## **3. 統一後架構設計**

我們將採用一個清晰的四層架構模型，確保各模組職責分離、易於維護。

```mermaid
graph TD
    subgraph "第四層：前端應用 (The Cockpit)"
        UI[統一前端應用<br>index.html]
        UI -- "查看真實組合" --> API_Gateway
        UI -- "<b>執行策略回測</b>" --> API_Gateway
        UI -- "<b>啟動個股掃描</b>" --> API_Gateway
    end

    subgraph "第三層：後端 API (The Control Plane)"
        API_Gateway[GCP Cloud Function 主入口]
        API_Gateway --> Portfolio_Handler[portfolio.handler.js]
        API_Gateway --> Backtest_Handler[<b>backtest.handler.js</b>]
        API_Gateway --> Scanner_Handler[<b>scanner.handler.js</b>]
    end

    subgraph "第二層：核心計算層 (The Universal Engine)"
        Portfolio_Handler -- "真實事件流" --> Engine
        Backtest_Handler -- "<b>模擬事件流</b>" --> Engine
        Scanner_Handler -- "<b>批次模擬事件流</b>" --> Engine
        
        Engine[<b>engine.js<br>通用計算引擎</b>]
        Simulator[<b>simulation.js<br>模擬事件生成器</b>]

        Backtest_Handler --> Simulator
        Scanner_Handler --> Simulator
    end

    subgraph "第一層：數據服務層 (The Data Hub)"
        Engine --> Data_Provider[data.provider.js]
        Data_Provider -- "<b>隨需獲取 & 快取</b>" --> External_API[Yahoo Finance API]
        Data_Provider -- "讀/寫" --> D1_Database
    end

    subgraph "底層：數據庫與自動化"
        D1_Database[Cloudflare D1]
        Automation[GitHub Actions (Python 腳本)]
        Automation -- "定期更新元數據" --> D1_Database
    end
```

## **4. 潛在風險與應對策略 (Critique & Mitigation)**

我們已對計畫進行了深入的批判性分析，並為識別出的主要風險制定了具體的應對策略：

| **潛在風險** | **應對策略** |
| :--- | :--- |
| **計算層的語言轉換挑戰**\<br\>將 Python/pandas 的數值計算邏輯移植到 JS 可能產生細微誤差。 | **1. 引入成熟函式庫**: 採用 `Danfo.js` 或 `Polars.js` 來處理複雜的數據操作，避免從零造輪子。\<br\>**2. 建立驗證基準**: 在移植前，使用原 Python 專案生成一份「黃金標準」的計算結果。JS 版本必須通過與此基準的比對測試，確保結果一致性。 |
| **Cloud Functions 的效能與超時風險**\<br\>大規模掃描任務可能因執行時間限制而失敗，前端輪詢不可靠。 | **引入非同步任務隊列**: 使用 **Google Cloud Tasks**。前端只需提交一次任務，後端會將其分解為數百個小任務並推入隊列。Cloud Functions 逐一處理這些短時間任務，前端則透過輪詢 API 來獲取即時進度，徹底規避超時風險。 |
| **數據隨需獲取的複雜性**\<br\>即時抓取大量股票數據會增加延遲，並可能觸發 API 速率限制。 | **批次預檢與請求合併**: 在啟動大規模計算前，前端會先將**所有**需要的股票代碼一次性傳給後端進行「數據覆蓋檢查」。後端會找出所有缺失的數據，透過**一次批次請求**從外部 API 抓取，然後再開始計算。這將數據獲取的延遲**前置**，並最大化地減少對外部 API 的請求次數。 |
| **前端效能瓶頸**\<br\>一次性將數百筆掃描結果渲染到 HTML 表格會導致頁面卡頓。 | **引入前端虛擬化渲染**: 採用 **Virtual Scrolling** 技術（如 `TanStack Virtual`）。無論結果有多少筆，DOM 中始終只渲染螢幕可見範圍內的少量元素，確保滾動和排序操作的絕對流暢。 |

## **5. 分階段執行計畫**

我們將計畫分為四個循序漸進的階段，每個階段都交付一個可用的功能模組。

### **第一階段：奠定基礎 - 統一計算引擎與數據後端**

  * **核心任務**: 建立 `stock_universe_metadata` 表；升級 Python 維護腳本以填充該表；用 JavaScript (`Danfo.js`) 移植 Python 的核心計算邏輯並建立驗證基準；建立 `simulation.js` (模擬事件生成器) 和 `engine.js` (統一計算引擎)；強化 `data.provider.js`，使其具備「隨需獲取」能力。
  * **交付成果**: 一套經過充分測試、功能強大的後端計算引擎與可自我擴展的數據中台。

### **第二階段：實現第一個可用功能 - 單一策略回測**

  * **核心任務**: 建立 `backtest.handler.js` 並開發 `run_backtest` API；在前端新增「投資實驗室」分頁，並將 `back_test` 的 UI 移植過來；建立對應的前端 JS 模組，對接 API 並用 ApexCharts 渲染結果。
  * **交付成果**: 使用者可在 `portfolio-journal` 內使用一個功能完整的策略回測工具，驗證第一階段架構的成功。

### **第三階段：擴展核心功能 - 大規模個股掃描器**

  * **核心任務**: 建立 `scanner.handler.js` 並開發 `screener_get_tickers` (篩選) 和 `scanner_run_batch_backtest` (計算) 兩個 API；前端實現與 **Google Cloud Tasks** 協作的非同步任務提交與進度輪詢邏輯；將最終彙整的數據渲染到一個使用**虛擬滾動**技術的可排序表格中。
  * **交付成果**: 一個能從數百支股票中，根據 Alpha、MDD 等指標進行高效篩選的強大策略發現工具。

### **第四階段：完美收尾 - 深度整合與體驗優化**

  * **核心任務**: 開發「**一鍵回測我的持股**」功能，打通真實數據與模擬分析的橋樑；開發「**儲存/載入策略**」功能，提升工具的實用性；重構前後端程式碼，抽象化通用組件；對系統進行壓力測試與效能調優。
  * **交付成果**: 一個功能高度整合、體驗流暢、架構清晰的**一站式個人量化投資平台**，並正式封存舊的 `back_test` 專案。

## **6. 結論**

本計畫透過一次徹底的架構重塑，不僅解決了技術棧分散、數據源不一的問題，更將兩個獨立專案的價值融合提升，創造出一個 **1 + 1 \> 5** 的整合平台。透過引入業界成熟的非同步處理模式與前端渲染技術，我們也為專案的長期穩定性、擴展性和卓越的使用者體驗奠定了堅實的基礎。

這份報告代表了我們對專案未來發展的清晰願景和周詳規劃。
