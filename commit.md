### **ATLAS-COMMIT v1.5 最終執行規劃**

#### **核心設計哲學 (我們共同的結論)**

我們的指導原則是：**優先保證使用者的操作流暢性與系統最終數據的絕對正確性**。我們接受在「樂觀更新」和「最終提交」之間可能存在的短暫認知偏差，將驗證最終結果的責任交還給使用者。因此，我們將**放棄**複雜的「版本衝突解決機制」，從而簡化架構，最大化使用者體驗。

#### **第一階段：奠定基礎 - 後端暫存區與 API 骨架**

此階段的目標是搭建新架構的骨幹，建立所有必要的資料庫結構與 API 端點。這是後續所有工作的基石。

1.  **流程：**
    * 在 Cloudflare D1 中建立新的 `staged_changes` 資料表。
    * 建立全新的後端 API 處理模組 `staging.handler.js` 來管理所有暫存邏輯。
    * 在主 API 入口 `index.js` 註冊新功能，使其可被前端呼叫。

2.  **程式碼修改與功能增修：**
    * **資料庫層**：
        * **新增資料表 `staged_changes`**：此為新架構的「唯一真相來源 (Single Source of Truth)」。Schema 包含 `id`, `uid`, `status` (預設為 'PENDING'), `error_message`, `entity_type` (將支援 'transaction', 'split', 'dividend', 'group_membership'), `operation_type` (CREATE, UPDATE, DELETE), `entity_id` (用於 UPDATE/DELETE), `payload` (操作的 JSON 數據)，以及 `created_at` 時間戳。

    * **後端 API 層 (`/functions`)**：
        * **新增檔案 `api_handlers/staging.handler.js`**：
            * **實作 `stageChange` 函式**：這是前端所有 CUD 操作的新入口。它會接收操作類型和數據 (`payload`)，驗證後寫入 `staged_changes` 表。
            * **實作 `revertStagedChange` 函式**：提供讓使用者撤銷單筆暫存操作的能力。
            * **實作 `getSystemHealth` 函式**：讓前端能定期查詢最新快照日期，監控系統健康狀態。
        * **修改檔案 `functions/index.js`**：
            * 在主 API 路由的 `switch` 區塊中，註冊所有來自 `staging.handler.js` 的新 `action`，包含 `'stage_change'`, `'revert_staged_change'`, `'get_system_health'`, 以及後續會用到的 `'get_transactions_with_staging'` 和 `'commit_all_changes'`。

---

#### **第二階段：核心變革 - 前端樂觀更新與工作流重構**

此階段將徹底改變使用者體驗，從「同步等待」變為「即時反饋」。

1.  **流程：**
    * 將所有資料修改操作（新增/編輯/刪除交易、股利、拆股、群組歸屬）的事件處理器，全面重構為「樂觀更新」模式。
    * 在 UI 中增加全局的、非阻塞式的提示橫幅，讓使用者清楚知道自己有未提交的變更，並提供提交入口。

2.  **程式碼修改與功能增修：**
    * **前端事件處理層 (`/js/events`)**：
        * **重構所有 CUD 事件處理器**：
            * 涉及檔案：`transaction.events.js`, `dividend.events.js`, `split.events.js`, `group.events.js`。
            * **修改內容範例 (以 `transaction.events.js` 中的 `handleDelete` 為例)**：
                * **原邏輯**：彈出確認框，然後呼叫 `executeApiAction`，等待後端完整重算後刷新整個 App。
                * **新邏輯**：
                    1.  彈出確認框。
                    2.  確認後，在前端 `state.transactions` 中找到該筆交易，並**樂觀地**將其 `status` 更新為 `'STAGED_DELETE'`。
                    3.  立即呼叫 `renderTransactionsTable()`，UI 會即時顯示帶有刪除線或不同樣式的該項目。
                    4.  在背景**非同步**呼叫 `apiRequest('stage_change', { op: 'DELETE', entity: 'transaction', payload: { id: txId } })`，將此操作意圖送入後端暫存區。

    * **前端 UI 層 (`/js/ui` & `index.html`)**：
        * **新增檔案 `js/ui/components/stagingBanner.ui.js`**：建立專門的模組來渲染和管理「您有 N 項未提交的變更 [全部提交]」的全局橫幅。
        * **修改檔案 `index.html`**：在 `<header>` 下方新增橫幅的 HTML 結構，預設為隱藏。
        * **修改檔案 `js/ui/components/transactions.ui.js`**：`renderTransactionsTable` 函式將增加邏輯，根據傳入的 `transaction.status` 屬性，為 `<tr>` 元素添加不同的 CSS class，例如 `bg-green-50` (新增)、`bg-yellow-50` (修改) 或 `line-through` (刪除)。

---

#### **第三階段：大腦升級 - 後端合併、提交與防呆機制**

此階段是新架構的「大腦」，確保所有暫存的變更都能被正確、高效、安全地處理，並將我們討論過的**所有盲點徹底解決**。

1.  **流程：**
    * 實作能夠正確合併連續操作鏈的 Reducer 邏輯。
    * 為讀取 API 實現高效能的分頁查詢。
    * 打造一個包含完整防呆機制的「全部提交」原子性工作流。

2.  **程式碼修改與功能增修：**
    * **後端 API 層 (`/functions/api_handlers/staging.handler.js`)**：
        * **實作 `getTransactionsWithStaging` 函式**：
            * **解決盲點一 (連續操作)**：內部實作一個「狀態合併 Reducer」。它會先讀取資料，然後在記憶體中按時間順序應用 `staged_changes` 表中的所有操作，能正確處理「新增 -> 修改 -> 刪除」這類操作鏈，確保回傳的是邏輯正確的最終狀態。
            * **解決盲點三 (效能)**：此 API 將接收分頁參數 (`page`, `pageSize`)。後端只從 `transactions` 表中用 `LIMIT` 和 `OFFSET` 查詢當前頁所需的數據，然後再與**所有**暫存變更（通常數量不多）進行合併，從根本上解決效能問題。

        * **實作 `commitAllChanges` 函式 (核心大腦)**：
            * **防呆 1 (防止並發)**：函式開始時，立即用 `batch_id` 將所有 `PENDING` 的變更狀態更新為 `COMMITTING`，防止使用者在處理過程中重複提交。
            * **防呆 2 (數據驗證)**：在寫入資料庫前，對所有變更的 `payload` 進行一次完整的 Zod Schema 驗證。任何驗證失敗的項目都會被標記為 `FAILED` 並記錄錯誤訊息，整個批次將被駁回，並向前端回報清晰的錯誤。
            * **解決盲點四 (功能整合)**：此函式將能處理所有 `entity_type`，包括 `'transaction'`, `'split'`, `'dividend'`, 和 `'group_membership'`。
            * **原子性寫入**：將所有對正式表的 CUD 操作（包括交易修改和群組歸屬修改），以及刪除已處理的 `staged_changes` 紀錄，全部放入一個 D1 `batch` 事務中執行。**這確保了整個提交過程要麼完全成功，要麼完全失敗，絕不會出現中間狀態。**
            * **高效重算**：從本次提交的所有變更中，找出最早的操作日期 `earliest_change_date`。然後**同步 `await`** 呼叫 `performRecalculation(uid, earliest_change_date, false)`，利用快照機制進行高效的增量計算。
            * **權威性回傳**：計算成功後，查詢並回傳**完整的、最新的投資組合狀態**（holdings, summary, history...），作為前端唯一的真相來源。

    * **前端 API 層與主流程 (`/js`)**：
        * **新增函式 `api.js` - `hydrateAppState(fullData)`**：建立一個專門的函式，用於接收 `commitAllChanges` 回傳的完整數據。它將**原子性地**更新前端所有相關的 `state`，然後觸發所有 UI 的一次性重繪，確保介面絕不失步。
        * **修改檔案 `js/main.js`**：
            * 為「全部提交」按鈕綁定事件。點擊後，顯示全局載入畫面，呼叫 `commitAllChanges` API，並在 `try...catch...finally` 結構中處理成功（呼叫 `hydrateAppState`）、失敗（顯示錯誤通知）和最終（隱藏載入畫面）的邏輯。
            * 實作一個定時器，定期呼叫 `getSystemHealth` API，檢查快照是否過舊（例如超過 10 天），並在必要時向使用者顯示一個非阻塞的提示，建議手動觸發週末腳本或聯繫管理員。

透過以上三個階段的整合執行，我們將一次性完成這次重要的架構升級。這個規劃不僅解決了最初的效能和體驗問題，還前瞻性地處理了連續操作、效能擴展和多功能整合的複雜性，並在關鍵節點設計了防呆和容錯機制。最終，我們將交付一個使用者體驗極致流暢、數據結果絕對正確、且架構穩固、易於長期維護的系統。
