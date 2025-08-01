# stock-data-updater

https://chihung1024.github.io/trading-journal/


trading-journal-1.08/
├── index.html                  ⬅️ 前端主畫面 (可能內含 Tailwind + Chart.js 或 ApexCharts)
├── main.py                     ⬅️ Python 核心邏輯，可能做股價或配息分析
├── initialize_database.py      ⬅️ 初始建立 Firebase Firestore 結構
├── firestore.rules             ⬅️ Firebase 資料存取權限設定
├── firebase.json               ⬅️ Firebase 專案設定檔
├── functions/                  ⬅️ Firebase Functions (Node.js) serverless API
│   ├── index.js                ⬅️ 核心 Cloud Functions 程式
│   └── package.json            ⬅️ Node.js 相依設定
├── .github/workflows/          ⬅️ GitHub Actions 自動化流程
│   ├── deploy_functions.yml    ⬅️ 自動部署 Cloud Functions
│   ├── initialize_db.yml       ⬅️ 初始化資料庫
│   └── update_prices.yml       ⬅️ 更新股價或配息等自動化排程
└── README.md                   ⬅️ 說明文件


一、 專案總體架構分析 (Architectural Overview)
這個專案是一個典型的 事件驅動 (Event-Driven) Serverless 架構，以 Google Firebase 作為核心。這種架構的優點是高擴展性、低維運成本，且能輕易實現前後端的即時資料同步。

主要的技術棧與分工如下：

前端 (Frontend): index.html 搭配 Vanilla JavaScript、Tailwind CSS 和 ApexCharts。它是一個直接與 Firebase 互動的「胖客戶端 (Fat Client)」，負責 UI 呈現、使用者輸入、以及即時資料的響應式更新。

後端 (Backend): Firebase Cloud Functions (functions/index.js)，使用 Node.js。這是整個系統的「大腦」，負責所有核心的財務計算。它不直接由前端呼叫，而是透過監聽 Firestore 資料庫的變化來觸發，實現了前後端的完美解耦。

資料庫 (Database): Firebase Firestore。它不僅是數據儲存中心，更是前後端之間的「通訊中介 (Message Bus)」。前端寫入原始交易，後端監聽並寫回計算結果，前端再即時響應這些結果。

數據管道 (Data Pipeline): Python 腳本 (main.py, initialize_database.py) 搭配 GitHub Actions (.github/workflows/)。這是一個獨立的自動化流程，專門負責從外部（Yahoo Finance）獲取股價、匯率等市場數據，並定期更新到 Firestore，確保系統計算的準確性。

安全性 (Security): firestore.rules 提供了精細的存取控制，確保使用者只能存取自己的資料，並保護後端計算結果不被客戶端意外竄改。

數據流核心思想：
使用者在前端產生「原始數據」（如交易紀錄），這些數據觸發後端 Cloud Functions 進行複雜的「衍生數據」（如投組總值、報酬率）計算，計算結果寫回資料庫，前端再透過即時監聽器 (real-time listener) 將這些「衍生數據」呈現給使用者。這是一個非常優雅且高效的模式。

二、 各部分程式碼深度解析
1. 前端 (index.html)
這是使用者與系統互動的唯一入口，其設計亮點頗多。

技術選型：

Tailwind CSS: 提供快速、一致的 UI 開發體驗，@apply 等 class 的使用讓版面井然有序。

ApexCharts: 強大的圖表庫，用於視覺化資產成長曲線和 TWR 報酬率，互動性強。

Vanilla JS (Module): 採用原生 JavaScript 模組 (type="module")，直接從 CDN 引入 Firebase SDK。這讓專案無需複雜的前端打包工具（如 Webpack、Vite），保持了輕量化。

核心功能：

即時資料綁定 (onSnapshot): 這是前端體驗的核心。程式碼中大量使用 onSnapshot 來監聽 transactions, splits, current_holdings, portfolio_history 等集合。這意味著一旦後端 Cloud Function 完成計算並更新資料庫，前端畫面會 自動更新，使用者無需手動刷新，提供了極佳的即時性。

用戶身份驗證 (firebase/auth): 完整的註冊、登入、登出流程。onAuthStateChanged 是一個關鍵的監聽器，它統一管理了使用者的登入狀態，並根據狀態決定是顯示登入畫面還是主控台。

前端表單處理 (handleFormSubmit)：

BUG FIX 亮點: 註解中明確標示了 FINAL BUG FIX，這段程式碼寫得非常漂亮。它動態地構建 payload 物件，並且在編輯模式下，如果使用者清空了選填欄位（如 exchangeRate 或 totalCost），它會使用 deleteField() 來徹底從 Firestore 文件中移除該欄位。這避免了在資料庫中留下 null 或空字串等髒數據，是專業開發的最佳實踐。

觸發後端計算的機制: 前端更新 benchmark 的 handleUpdateBenchmark 函式，並不是自己去計算，而是寫入一個特定的文件 users/{userId}/controls/benchmark_control。這是一個 "信令" (signaling) 機制，目的是為了觸發後端的 Cloud Function。這種間接觸發的方式確保了前端的職責單一（只負責發出指令）。

2. 後端核心邏輯 (functions/index.js)
這是專案的「心臟」，負責所有複雜且耗時的財務計算。

架構設計：

統一觸發點 (force_recalc_timestamp): 這是整個後端架構的點睛之筆。開發者沒有讓每個觸發器（交易新增、拆股新增、股價更新）都各自執行一次完整的計算邏輯，而是讓它們去更新 users/{uid}/user_data/current_holdings 文件中的一個 force_recalc_timestamp 欄位。

然後，一個專門的函式 recalculatePortfolio 監聽這個欄位的變化。這樣做的好處是：

邏輯集中： 所有計算邏輯都放在 performRecalculation 一個函式中，易於維護和除錯。

避免競爭條件： 如果短時間內發生多次更新（例如，快速新增兩筆交易），可以有效合併計算，避免重複執行。

職責清晰： 觸發器只負責「通知」，計算函式只負責「計算」。

財務工程計算 (performRecalculation & helpers):

事件整合 (prepareEvents): 將交易 (transactions)、拆股 (splits)、甚至從市場數據中提取的股息 (dividends) 全部整合成一個按時間排序的「事件流」(event stream)。這是進行時間序列分析（如 TWR）的標準前置作業。

每日市值計算 (calculateDailyPortfolioValues): 透過回溯所有歷史事件，計算出從第一筆交易至今 每一天 的投資組合市場價值。這是資產成長曲線圖的數據來源。

時間加權報酬率 (calculateTwrHistory): 這是衡量基金經理人績效的行業標準。該函式正確地處理了外部現金流（買入、賣出、股息）對報酬率計算的影響，公式 MVE / (MVB + CF) 的應用是正確的。這顯示開發者具備專業的財務知識。

年化報酬率 (calculateXIRR): 內部報酬率 (IRR) 的擴展版，考慮了不規則現金流的發生時間。這裡使用了數值分析中的 牛頓-拉夫遜法 (Newton-Raphson method) 來迭代求解，這是一個標準的數值解法。

持股與損益計算 (calculateCoreMetrics, calculateFinalHoldings):

採用 先進先出法 (FIFO) 來計算賣出股票的已實現損益。

BUG FIX 亮點: calculateFinalHoldings 中，明確區分了 holdingsToUpdate 和 holdingsToDelete。當一檔股票被完全賣出後（股數為 0），它會被加入刪除列表，後續會使用 FieldValue.delete() 從資料庫中乾淨地移除，避免 UI 上出現股數為 0 的無效持股。這再次體現了開發的嚴謹性。

3. 數據維護腳本 (main.py, initialize_database.py)
這兩支 Python 腳本組成了專案的數據後勤系統。

initialize_database.py: 一次性的初始化腳本，用來抓取並填充基礎的匯率數據。這是系統冷啟動的必要步驟。

main.py:

執行時機: 由 update_prices.yml 中的 cron 排程觸發，每日自動執行。

數據抓取目標 (get_all_symbols_to_update): 這裡使用了 Firestore 的 collection_group 查詢，這是一個非常強大且高效的功能。它能跨越所有 users 子集合，一次性找出所有使用者交易過或設為 benchmark 的股票代碼，構建一個不重複的更新清單。

數據更新策略 (fetch_and_update_market_data):

它抓取的是 period="max" 的 完整歷史數據，而不僅僅是當天的數據。

註解中提到，這樣做是為了「最大化穩健性」和「自我修復數據缺口」。這是一個非常明智的決定。如果某天的自動化任務失敗，下一次成功執行時就能補全所有歷史數據，確保數據的完整性。

4. 自動化與部署 (.github/workflows/*.yml)
deploy_functions.yml: 實現了 CI/CD。當 functions/ 目錄有程式碼變更並推送到 main 分支時，會自動部署 Cloud Functions。

update_prices.yml: 自動化排程，是數據管道的核心。

initialize_db.yml: 提供 workflow_dispatch 手動觸發，方便在需要時（如系統初建或遷移）執行資料庫初始化。

5. 安全規則 (firestore.rules)
安全規則是 Firebase 應用安全的基石，這裡的規則設計得非常嚴謹。


allow read, write: if request.auth.uid == userId;: 這是最基本的規則，確保使用者只能在自己的 users/{userId} 路徑下讀寫。 


allow write: if false;: 這是最重要的安全規則之一。它應用在 user_data 子集合上，禁止所有客戶端（前端 index.html）的寫入操作。  這意味著所有計算結果（總資產、報酬率等）

只能由擁有管理員權限的後端 Cloud Functions 寫入。這有效防止了使用者透過竄改前端請求來偽造自己的資產數據。


公開數據的唯讀權限: price_history 和 exchange_rates 集合對所有登入使用者開放讀取權限，但同樣禁止客戶端寫入。 