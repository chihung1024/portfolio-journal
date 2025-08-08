系統架構總覽
這是一個基於現代雲端服務的無伺服器 (Serverless) 網頁應用程式，專為股票投資組合管理而設計。其架構分為以下幾個核心部分：

前端 (Frontend): 一個使用 HTML、TailwindCSS 和原生 JavaScript 建構的單頁應用程式 (SPA)。它負責使用者介面、互動邏輯，並透過 Firebase 進行身份驗證。

後端 API (Backend API): 一個部署在 Google Cloud Functions 上的 Node.js 應用程式 (index.js)，作為核心業務邏輯處理中心。它負責處理所有來自前端的請求，如資料讀取、交易新增/刪除等。

核心計算引擎 (Calculation Engine): 後端 API 的一部分 (calculation.engine.js)，是整個系統的大腦。它負責所有複雜的財務計算，例如報酬率、歷史資產淨值、持股狀態等。

資料庫 (Database): 使用 Cloudflare D1，一個無伺服器的 SQL 資料庫。用於儲存所有使用者資料，包括交易、持股、筆記以及市場數據等。

資料庫代理 (Database Proxy): 一個 Cloudflare Worker (worker.js)，作為一個安全的 HTTP 代理，讓後端維護腳本可以透過 API 金鑰存取 D1 資料庫。

自動化數據維護 (Automation): 使用 GitHub Actions (.yml 檔案) 定期執行 Python 腳本 (main.py, main_weekend.py)，從 Yahoo Finance 自動抓取並更新市場數據到 D1 資料庫中。

核心資料流程與使用者旅程
登入與初始化:

使用者在前端介面 (index.html) 輸入信箱和密碼。

auth.js 模組使用 Firebase Authentication 進行身份驗證。

驗證成功後，前端會觸發 loadPortfolioData 函式。

api.js 向後端 GCP Cloud Function (index.js) 發送 get_data 請求，並在標頭中附帶 Firebase 的認證權杖。

資料請求與渲染:

後端 index.js 的 verifyFirebaseToken 中介軟體會驗證權杖的合法性。

驗證通過後，後端從 D1 資料庫中查詢該使用者的所有相關資料（交易、持股、歷史摘要等），並回傳給前端。

前端 api.js 接收到資料後，更新 state.js 中的應用程式狀態，並呼叫 ui.js 中的渲染函式。

ui.js 根據最新的狀態，動態生成儀表板、持股表格和圖表，將資料呈現給使用者。

使用者操作 (例如：新增交易):

使用者在前端 Modal 中填寫交易表單並儲存。

main.js 立即更新前端介面（樂觀更新 Optimistic Update），讓使用者感覺操作立即生效。

同時，main.js 透過 api.js 向後端發送 add_transaction 請求。

後端 index.js 接收請求，使用 zod (schemas.js) 驗證傳入資料的格式是否正確。

資料驗證成功後，將新交易寫入 D1 資料庫。

關鍵步驟：後端立即呼叫 performRecalculation 函式，對該使用者的整個投資組合進行重新計算。

計算完成後，前端會被觸發進行一次完整的資料同步 (requestDataSync)，確保介面顯示的是經過後端精確計算後的最終結果。

後端 API (index.js) 與計算引擎 (calculation.engine.js)
這是系統最核心的部分，負責安全、資料處理與複雜計算。

主要功能：

安全與驗證:

所有來自前端的請求都必須通過 verifyFirebaseToken 中介軟體的驗證，確保只有已登入的使用者能存取自己的資料。

對於來自後端自動化腳本的請求，則使用獨立的 SERVICE_ACCOUNT_KEY 進行驗證，實現了系統間的安全通訊。

所有使用者輸入都透過 zod 進行嚴格的 schema 驗證，防止不合規的資料寫入資料庫。

核心計算引擎 (performRecalculation):

事件溯源 (Event Sourcing) 方法: 系統將每一筆交易、拆股、股息都視為一個「事件」。計算時，它會按時間順序重播所有事件，來建構出任何一個時間點的投資組合狀態。這是處理複雜、時序相關財務計算的黃金標準。

混合計算與快照 (Hybrid Calculation with Snapshots): 為了避免每次都從頭計算，系統設計了快照機制。

週末的維護腳本會觸發一次完整計算，並在 D1 建立一個 portfolio_snapshots。

當後續有新的交易時，計算引擎會從最近的有效快照開始增量計算，而非從第一筆交易開始，大幅提升了計算效率。

快照失效機制: 這是確保資料正確性的關鍵設計。如果使用者修改或刪除了一筆歷史交易，其日期早於最新的快照日期，系統會自動將該快照及之後的所有快照標記為無效並刪除，強制進行一次完整的重新計算，從而保證了數據的絕對準確性。

即時市場數據校驗: 在每次計算前，引擎會檢查所需的市場數據（股價、匯率）是否已存在於 D1 資料庫中，並確保其更新到最新狀態 (ensureDataFreshness)。如果數據缺失或過舊，會即時從 Yahoo Finance 抓取並存入資料庫。

財務指標計算:

已實現/未實現損益: 透過 FIFO (先進先出) 原則追蹤每一批買入的股票 (lots)，在賣出時精確計算已實現損益。

時間加權報酬率 (TWR): 排除現金流（買入/賣出）的影響，準確衡量投資策略本身的表現，並與 Benchmark (如 SPY) 進行比較。

內部報酬率 (XIRR): 考慮所有現金流的時間價值，計算出個人的年化報酬率。

股息處理: 系統會自動計算「待確認股息」(calculateAndCachePendingDividends)，並在使用者確認或批次確認後，將其計入已實現損益。

自動化數據維護 (Python & GitHub Actions)
為了讓系統能自動獲取最新市價，後端設計了兩套自動化腳本，並由 GitHub Actions 排程執行。

每日增量更新 (main.py & update_prices.yml):

此腳本每天會被執行三次 (00:00, 14:00, 22:00 UTC)。

它會從資料庫中找出所有使用者持倉的股票代碼，然後只抓取從上次更新到現在的「增量」市場數據，並寫入 D1 資料庫。

更新完畢後，它會觸發後端 API 的 recalculate_all_users 動作，讓所有使用者的投資組合數據保持最新狀態。

週末完整校驗 (main_weekend.py & weekend_maintenance.yml):

此腳本每週日執行一次。

它會抓取所有股票的「完整」歷史數據，以校正每日增量更新中可能出現的遺漏或錯誤。

為了確保資料安全，它採用了預備表 (Staging Table) 機制：先將抓取到的完整數據寫入預備表，成功後再以一個原子操作覆蓋正式表，防止更新過程中出現資料不一致的問題。

完成後，它同樣會觸發所有使用者重算，並附帶 createSnapshot: True 參數，指示計算引擎建立本週的計算快照。
