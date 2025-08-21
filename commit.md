好的，這是一份為您重新彙整、涵蓋所有討論細節與最終決策的**完整版架構優化提案**。

本文件以第三方審查的最高標準撰寫，結構嚴謹、細節詳盡，旨在清晰地向任何審查單位（包括內部管理層與外部顧問）闡述此項架構升級的必要性、穩健性與卓越價值。

-----

## **架構優化最終提案：ATLAS-COMMIT v1.4**

**文件版本**: 2.0 (最終審查版)
**專案代號**: ATLAS-COMMIT
**呈報單位**: 核心開發團隊
**審閱單位**: 專案審查委員會 / 第三方顧問

### **1.0 執行摘要 (Executive Summary)**

**問題陳述**:
本系統現行的「即時同步」架構，導致使用者每一次交易變更（新增/修改/刪除）都會觸發一次完整的後端重算。此模型在高頻操作下，已引發**伺服器計算成本飆升**與**前端使用者體驗嚴重延遲**兩大核心瓶頸，限制了系統的長期發展與使用者滿意度。

**解決方案**:
本提案旨在實施代號為 **ATLAS-COMMIT** 的全新架構。其核心是引入一個以**資料庫為中心**的**交易暫存區 (Staging Area)**，並將使用者的多次獨立操作，彙整為一次**同步的、批次處理 (Batch Processing)** 的提交。此方案將徹底**解耦**使用者的操作意圖與後端的計算執行。

**核心優勢**:

1.  **極致使用者體驗**: 透過**樂觀更新 (Optimistic UI Updates)**，使用者的所有操作都將在前端獲得**零延遲**的即時反饋，徹底消除「操作-等待」的卡頓感。
2.  **大幅降低計算負擔**: 將原先因數十次操作引發的數十次重算，合併為**一次**最終的、利用**快照 (Snapshot) 進行增量計算**的高效重算，預計可將核心計算負擔降低超過 90%。
3.  **架構的絕對穩健性**: 新架構引入了**狀態機**、**預驗證**及**原子性資料庫事務**等防禦性設計，並強化了對極端情況（如陳舊快照、深度歷史編輯）的處理與監控，確保了數據的完整性與系統的長期穩定。

**結論**:
ATLAS-COMMIT v1.4 是一次從「可用」邁向\*\*「卓越」\*\*的戰略性架構演進。它在不犧牲使用者心智模型直覺性的前提下，從根本上解決了性能瓶頸，是一項對專案長期價值有著巨大正面影響的、高回報的工程投資。

### **2.0 架構詳解**

#### **2.1 核心理念**

在歷經多輪嚴格審查後，我們確立了最終的核心理念：

> **在保持前端使用者體驗絕對直覺（操作即保存）的同時，將所有複雜性（狀態管理、數據驗證、計算優化）後移至一個穩健、同步、且具備防禦性設計的後端工作流中。**

#### **2.2 新架構工作流程**

```mermaid
graph TD
    subgraph "前端 (Browser)"
        A[使用者操作] -->|1. 立即在前端 State 模擬變更| B(樂觀更新 UI);
        B -->|2. 背景發送 API| C{API: /stage_change};
        C -->|3. API < 1s 回傳受理| B;
        D[全局提示橫幅<br>您有 N 項待辦] --> E[全部提交按鈕];
        E -->|4. 觸發| F{API: /commit_all_changes};
        F -->|7. API 回傳完整新狀態| G[hydrateAppState(fullData)];
        G -->|8. 原子性刷新所有 UI| H[儀表板/圖表/列表];
    end

    subgraph "後端 (Google Cloud Run)"
        C -->|將操作意圖寫入| I[staged_changes 表];
        F -->|5. 執行同步工作流| J(預驗證 -> 原子性寫入 -> 增量重算);
        J -->|6. 計算完成| F;
    end

    subgraph "資料庫 (Cloudflare D1)"
        I;
        J -->|寫入/更新/刪除| K[transactions 等正式表];
        J -->|刪除| I;
        J -->|讀取快照與價格| L[portfolio_snapshots & price_history];
    end
```

### **3.0 功能與程式碼修改詳述**

#### **3.1 資料庫層 (Database Layer)**

  * **新增資料表: `staged_changes`**
      * **用途**: 作為所有使用者未提交操作的唯一真實來源 (Single Source of Truth)，並記錄其處理狀態。
      * **最終版 Schema**:
        ```sql
        CREATE TABLE staged_changes (
            id TEXT PRIMARY KEY,
            uid TEXT NOT NULL,
            -- 為每一次「提交」操作建立一個唯一的批次 ID，用於追蹤
            batch_id TEXT,
            -- 明確的狀態機：PENDING (待辦), COMMITTING (處理中), FAILED (失敗)
            status TEXT NOT NULL DEFAULT 'PENDING',
            -- 具體的錯誤訊息，用於前端錯誤歸因
            error_message TEXT,
            entity_type TEXT NOT NULL, -- e.g., 'transaction', 'split'
            operation_type TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE'
            entity_id TEXT, -- UPDATE/DELETE 時使用
            payload TEXT, -- JSON 格式的操作數據
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        -- 為高效查詢建立複合索引
        CREATE INDEX idx_staged_changes_uid_status ON staged_changes(uid, status);
        ```

#### **3.2 後端 API 層 (`/functions`)**

  * **新增 API 處理模組: `api_handlers/staging.handler.js`**

      * **`exports.stageChange`**: 接收單筆操作，驗證後寫入 `staged_changes` 表，`status` 為 `PENDING`。
      * **`exports.getTransactionsWithStaging`**: 融合 `transactions` 表和 `staged_changes` 表的數據，為前端提供帶有 `status` 標記的統一視圖。
      * **`exports.revertStagedChange`**: 根據 `id` 刪除 `staged_changes` 中的單筆待辦事項。
      * **`exports.commitAllChanges` (核心)**:
        1.  **狀態標記**: 接收請求後，立即為該用戶所有 `PENDING` 的變更生成 `batch_id` 並將 `status` 更新為 `COMMITTING`。
        2.  **預驗證 (Pre-validation)**: 在記憶體中預演所有變更，進行 schema 和業務邏輯驗證。失敗則將 `status` 更新為 `FAILED`，寫入 `error_message`，並向前端回傳失敗訊息。
        3.  **原子性寫入**: 驗證通過後，在單一 D1 `batch` 事務中，執行所有對正式表的 CUD 操作，並刪除 `staged_changes` 中對應的紀錄。
        4.  **增量計算**:
              * 分析批次中所有變更的最早日期 `earliest_change_date`。
              * **同步呼叫** `performRecalculation(uid, earliest_change_date, false)`，利用快照機制進行高效計算。
        5.  **回傳結果**: 計算完成後，回傳 `HTTP 200 OK` 及完整的最新投資組合數據。

  * **新增 API: `get_system_health`**

      * 用於前端監控「陳舊快照」問題，回報 `last_snapshot_date`。

  * **修改主入口: `index.js`**

      * 註冊上述所有新的 API `action`。

#### **3.3 前端應用層 (`/js`)**

  * **狀態管理: `state.js`**

      * 新增 `hasStagedChanges: false` 旗標，用於快速判斷 UI 顯示。

  * **API 層: `api.js`**

      * 新增對應後端所有新 API 的呼叫函式。
      * **新增 `hydrateAppState(fullData)` 函式**: 建立一個統一的入口，用於接收後端回傳的完整 portfolio 狀態，並**原子性地**更新前端所有相關的 `state`，確保數據絕不失步。

  * **事件處理: `events/*.events.js`**

      * 所有 CUD 操作（新增/修改/刪除交易、股利、拆股）的邏輯將全面重構為：
        1.  **樂觀更新**: 立即在前端 `state` 中模擬變更。
        2.  **立即重繪**: 呼叫 `render...()` 函式，讓使用者看到即時反饋。
        3.  **背景暫存**: 在背景呼叫 `api.stageChange()` 將變更持久化到後端資料庫。失敗則回滾 UI 狀態並提示。

  * **UI 渲染: `ui/components/*.ui.js`**

      * `transactions.ui.js` 等列表渲染函式將被改造，使其能識別從 `get_transactions_with_staging` API 獲取的 `status` 欄位，並為 `'STAGED_CREATE'`（綠色背景）、`'STAGED_UPDATE'`（黃色背景）、`'STAGED_DELETE'`（刪除線）以及 `'FAILED'`（紅色邊框）的項目渲染出不同的視覺樣式。

  * **主流程: `main.js` & `index.html`**

      * 新增全局的「待辦事項」提示橫幅 (`#staging-banner`)，根據 `state.hasStagedChanges` 顯示或隱藏。
      * 為「全部提交」按鈕綁定 `commitAllChanges` API 呼叫，並在等待期間顯示全局載入畫面。
      * 實作「陳舊快照」的健康檢查與前端告警。

### **4.0 風險管理與緩解策略**

  * **陳舊快照風險**: 透過 `get_system_health` API 和前端 UI 告警進行監控與透明化。
  * **深度歷史編輯超時風險**:
      * **主要緩解**: 依賴 `performRecalculation` 的增量計算機制，在絕大多數情況下將計算時間控制在可接受範圍。
      * **輔助緩解**:
        1.  為 `main_weekend.py` 腳本增加執行失敗時的主動告警。
        2.  在前端對單次可提交的變更數量設置上限（例如 50 筆）。
        3.  為後端 `commit_all_changes` API 配置一個較長的超時時間（120 秒）作為最終防線。
  * **提交失敗的錯誤歸因**: 透過 `staged_changes` 表中的 `error_message` 欄位和對應的前端 UI 標示，為使用者提供清晰、可操作的錯誤反饋。

### **5.0 結論**

**ATLAS-COMMIT v1.4** 是一個經過多輪嚴格審查、深度思考後形成的、高度穩健的架構方案。它在保留使用者熟悉的同步體驗的同時，透過引入資料庫暫存區、批次處理和增量計算，從根本上解決了系統的性能瓶頸。

此提案不僅僅是一次技術升級，更是對**使用者體驗流暢性**、**數據處理健壯性**和**系統長期可維護性**的一次全面承諾。我們相信，這是在當前階段，能夠以最合理的成本，實現最大化價值的最佳工程路徑。
