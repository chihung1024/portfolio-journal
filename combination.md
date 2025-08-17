好的，這是一份為您準備的、更詳細的 Markdown 格式執行計畫。您可以將此文件儲存起來，作為我們未來專案執行的藍圖和備忘錄。

-----

# **專案統一計畫：`portfolio-journal` & `back_test` 整合藍圖**

**版本**: 1.0
**日期**: 2025-08-17

## **一、 核心理念與最終目標**

本計畫旨在將 `portfolio-journal`（一個基於真實交易紀錄的投資組合分析工具）與 `back_test`（一個基於假設規則的策略回測工具）進行深度整合。

我們的核心哲學是**將「策略回測」抽象化為對一套「模擬生成的交易事件」的分析**。透過建立一個能夠處理任何事件流（無論真實或模擬）的**通用計算引擎 (Universal Calculation Engine)**，我們可以完美地將兩個專案的功能融合在一個統一、高效且易於維護的架構之下，打造一個一站式的個人量化投資平台。

## **二、 整合後技術棧**

  * **前端**: HTML, Tailwind CSS, JavaScript (ESM), ApexCharts.js
  * **後端**: Google Cloud Functions (Node.js 18+)
  * **資料庫**: Cloudflare D1 (SQL)
  * **驗證**: Firebase Authentication
  * **自動化**: GitHub Actions (Python for data maintenance)

-----

## **三、 分階段執行計畫**

### **第一階段：奠定基礎 - 統一計算引擎與數據後端**

**目標**: 建立所有未來功能賴以維生的共享後端基礎設施。此階段結束時，後端將具備處理真實與模擬計算的能力，並擁有一個可自我擴展的數據池。

| 任務編號 | 任務名稱 | 詳細說明 | 相關檔案/模組 |
| :--- | :--- | :--- | :--- |
| **1.1** | **(數據層) 建立元數據表** | 在 Cloudflare D1 中，手動或透過腳本建立 `stock_universe_metadata` 資料表。欄位應包含：`symbol` (主鍵), `name`, `market_cap`, `sector`, `in_sp500` (布林), `in_nasdaq100` (布林), `last_updated`。 | Cloudflare D1 Console |
| **1.2** | **(數據層) 升級週末維護腳本** | 擴展 `main_weekend.py`，加入新函式。此函式將：\<br\>1. 從 `back_test` 專案中移植獲取指數成分股的邏輯 (`get_sp500`, `get_nasdaq100` 等)。\<br\>2. 抓取成分股的市值、產業等元數據。\<br\>3. 使用 `INSERT OR REPLACE` 語句批量更新 D1 的 `stock_universe_metadata` 表。 | `main_weekend.py` |
| **1.3** | **(計算層) 移植核心指標算法** | 將 `back_test/api/utils/calculations.py` 中的所有財務指標計算邏輯（CAGR, MDD, Sharpe, Alpha, Beta 等），用 JavaScript 重新實現，並整合到 `functions/calculation/metrics.calculator.js` 中。 | `metrics.calculator.js` |
| **1.4** | **(計算層) 建立模擬事件生成器** | 建立**新檔案** `functions/calculation/simulation.js`。此模組將是融合的關鍵，其核心函式 `generateSimulatedEvents` 接收回測參數（標的、權重、起始金額、再平衡週期），並根據 D1 的歷史價格，**生成一個模擬的「交易事件」陣列**，其格式需與 `prepareEvents` 函式處理真實交易後產生的格式完全一致。 | `simulation.js` **(新增)** |
| **1.5** | **(計算層) 建立統一計算引擎** | 建立**新檔案** `functions/calculation/engine.js`。其核心函式 `runCalculationEngine` 接收一個標準化的 `events` 陣列，調用現有的 `state.calculator.js` 和 `metrics.calculator.js` 來完成所有計算，最後回傳一個包含所有結果的標準化物件。 | `engine.js` **(新增)** |
| **1.6** | **(數據服務層) 強化數據提供者** | 升級 `functions/calculation/data.provider.js`，加入「**隨需獲取 (Fetch-on-Demand)**」功能。在 `ensureAllSymbolsData` 函式中，增加檢查 `market_data_coverage` 表的邏輯。如果請求的股票數據不存在，則自動從 Yahoo Finance 抓取並寫入 D1 的 `price_history` 等相關表格，並更新 `market_data_coverage`。 | `data.provider.js` |

**阶段交付成果**: 一套功能強大、可獨立測試的後端 API 與數據處理模組。雖然前端無變化，但後端架構已完成革命性升級。

-----

### **第二階段：實現第一個可用功能 - 單一策略回測**

**目標**: 將 `back_test` 的核心功能在 `portfolio-journal` 中重現，交付第一個看得見摸得著的整合成果，驗證第一階段後端架構的成功。

| 任務編號 | 任務名稱 | 詳細說明 | 相關檔案/模組 |
| :--- | :--- | :--- | :--- |
| **2.1** | **(後端 API) 建立回測 Handler** | 建立**新檔案** `functions/api_handlers/backtest.handler.js`。 | `backtest.handler.js` **(新增)** |
| **2.2** | **(後端 API) 開發回測 Action** | 在 `backtest.handler.js` 中建立 `run_backtest` 函式。它將：\<br\>1. 接收前端傳來的回測參數。\<br\>2. 呼叫 `simulation.js` 生成模擬事件流。\<br\>3. 將事件流送入 `engine.js` 進行計算。\<br\>4. 將計算結果回傳。並在 `functions/index.js` 中註冊此 action。 | `backtest.handler.js`, `index.js` |
| **2.3** | **(前端介面) 建立新分頁** | 在 `index.html` 中，複製一個現有 tab 結構，建立一個新的、ID 為 `lab-tab` 的「**投資實驗室**」主分頁。 | `index.html` |
| **2.4** | **(前端介面) 移植回測 UI** | 將 `back_test/public/backtest.html` 的 UI 佈局（資產配置網格、參數設定面板、結果顯示區等）移植到 `lab-tab` 中，並使用 Tailwind CSS 使其風格與主應用程式保持一致。 | `index.html` |
| **2.5** | **(前端邏輯) 建立回測 UI 與事件模組** | 建立**新檔案** `js/ui/components/backtest.ui.js` 和 `js/events/backtest.events.js`，將原 `back_test` 前端 JS 的邏輯模組化地遷移過來，負責新介面的渲染與互動。 | `backtest.ui.js` **(新增)**, `backtest.events.js` **(新增)** |
| **2.6** | **(前端邏輯) 對接 API 與渲染** | 將「執行回測」按鈕的事件綁定到 `run_backtest` API。成功獲取數據後，調用 `backtest.ui.js` 中的渲染函式，使用 ApexCharts 顯示回測結果圖表與數據表格。 | `backtest.events.js` |

**阶段交付成果**: 使用者可以在 `portfolio-journal` 內部，使用一個功能完整、體驗一致的策略回測工具。

-----

### **第三階段：擴展核心功能 - 大規模個股掃描器**

**目標**: 實現您提出的大範圍股票池篩選與績效掃描功能，將應用從「驗證工具」提升為「發現工具」。

| 任務編號 | 任務名稱 | 詳細說明 | 相關檔案/模組 |
| :--- | :--- | :--- | :--- |
| **3.1** | **(後端 API) 建立掃描器 Handler** | 建立**新檔案** `functions/api_handlers/scanner.handler.js`。 | `scanner.handler.js` **(新增)** |
| **3.2** | **(後端 API) 開發股票池篩選 Action** | 在 `scanner.handler.js` 中建立 `screener_get_tickers` 函式。它將根據前端傳來的篩選條件（市值、產業），快速查詢 D1 的 `stock_universe_metadata` 表，回傳一個符合條件的股票代碼陣列。 | `scanner.handler.js`, `index.js` |
| **3.3** | **(後端 API) 開發分批回測 Action** | 在 `scanner.handler.js` 中建立 `scanner_run_batch_backtest` 函式。它接收一小批股票代碼，對它們**並行**執行回測計算，並一次性回傳這一批次的績效指標。 | `scanner.handler.js`, `index.js` |
| **3.4** | **(前端介面) 建立掃描器 UI** | 在「投資實驗室」分頁中，新增「個股掃描器」的 UI 區塊，包含股票池、市值、產業的篩選器及一個用於顯示結果的表格區域。 | `index.html` |
| **3.5** | **(前端邏輯) 實作分批處理** | 在 `backtest.events.js` 中新增掃描器相關的事件處理邏輯。它將：\<br\>1. 呼叫 API 獲取目標列表。\<br\>2. 將列表拆分，**迴圈呼叫**分批回測 API，並更新介面上的即時進度條。\<br\>3. 將每一批的結果彙整到一個本地陣列中。 | `backtest.events.js` |
| **3.6** | **(前端邏輯) 結果渲染與排序** | 當所有批次完成後，將最終結果渲染到一個**可排序**的表格中。為表格的表頭添加點擊事件，允許使用者按任何績效指標（特別是 Alpha 和 MDD）對結果進行排序。 | `backtest.ui.js` |

**阶段交付成果**: 一個功能強大的個股掃描工具，可以幫助您從數百支股票中，根據量化指標快速發現潛在的投資機會。

-----

### **第四階段：完美收尾 - 深度整合與體驗優化**

**目標**: 打通真實紀錄與策略回測之間的壁壘，重構優化程式碼，提升整體使用體驗，完成專案的最終形態。

| 任務編號 | 任務名稱 | 詳細說明 | 相關檔案/模組 |
| :--- | :--- | :--- | :--- |
| **4.1** | **(深度整合) 一鍵回測持股** | 在主儀表板的持股列表旁，新增「回測我的持股」按鈕。點擊後，自動讀取當前持股及權重，跳轉至「投資實驗室」分頁並將這些參數填入回測器中。 | `holdings.ui.js`, `general.events.js`, `backtest.ui.js` |
| **4.2** | **(深度整合) 儲存/載入策略** | 允許使用者將回測器中的資產配置命名並儲存。這需要：\<br\>1. 在 D1 建立 `saved_strategies` 表。\<br\>2. 建立對應的 `save_strategy` 和 `get_strategies` 後端 API。\<br\>3. 在前端回測器介面新增「儲存」按鈕和一個「載入策略」的下拉選單。 | D1, `backtest.handler.js`, `backtest.ui.js`, `backtest.events.js` |
| **4.3** | **(程式碼優化) 抽象化 UI 組件** | 檢查「儀表板」和「投資實驗室」是否有重複的 UI 渲染邏輯（如績效表格、圖表設定）。將這些邏輯抽象成可重用的函式，放到 `js/ui/components/common.js` (新檔案) 或其他合適的模組中。 | 全局 JS 檔案 |
| **4.4** | **(體驗優化) 效能調優** | 對後端 API 進行壓力測試，特別是 `scanner_run_batch_backtest`，優化其並行處理能力。檢查前端在處理大量掃描結果時的渲染效能。 | `scanner.handler.js`, `backtest.ui.js` |
| **4.5** | **(專案收尾) 更新文件與封存** | 撰寫一份更新後的 `README.md`，詳細說明新架構和所有功能。在確認新系統穩定運行後，正式將 `chihung1024/back_test` GitHub 專案**封存 (Archive)**。 | `README.md`, GitHub |

**阶段交付成果**: 一個功能高度整合、體驗流暢、架構清晰且易於未來擴展的、真正意義上的**一站式個人量化投資平台**。
