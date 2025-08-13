**架構示意圖：**
```mermaid
graph TD
    subgraph "用戶端 (Browser)"
        A[使用者] --> B{前端應用<br>index.html, main.js, ...};
    end

    subgraph "後端 (Google Cloud Functions)"
        C[Cloud Function API<br>index.js];
        D[核心計算引擎<br>performRecalculation.js];
        E[API 處理模組<br>*.handler.js];
    end

    subgraph "資料庫 (Cloudflare)"
        F[Cloudflare D1 資料庫];
        G[D1 安全代理 Worker<br>worker.js];
    end
    
    subgraph "自動化維護 (GitHub Actions)"
        H[每日/週末排程<br>*.yml];
        I[Python 數據抓取腳本<br>main.py, ...];
        J[Yahoo Finance API]
    end

    B -- API 請求 (帶 Firebase Token) --> C;
    C -- 驗證 Token & 分發任務 --> E;
    E -- 呼叫核心計算 --> D;
    D -- 讀寫資料 --> G;
    E -- 讀寫資料 --> G;
    G -- 執行 SQL (帶 D1 API Key) --> F;
    
    H -- 觸發執行 --> I;
    I -- 抓取數據 --> J;
    I -- 寫入數據 (帶 D1 API Key) --> G;
    I -- 數據更新後觸發全體重算 (帶服務帳號 Key) --> C;
