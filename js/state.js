// =========================================================================================
// == 狀態管理模組 (state.js) v3.1.0
// =========================================================================================

// 應用程式的核心狀態
let state = {
    currentUserId: null,
    transactions: [],
    userSplits: [],
    stockNotes: {},
    marketDataForFrontend: {},
    pendingDividends: [],
    confirmedDividends: [],
    holdings: {}, // [新增] 用於儲存持股資料物件
    isAppInitialized: false,
    chart: null,
    twrChart: null,
    confirmCallback: null,

    // [新增] 篩選與排序狀態
    transactionFilter: 'all', // 'all' 或 股票代碼
    dividendFilter: 'all',    // 'all' 或 股票代碼
    holdingsSort: {
        key: 'marketValueTWD', // 預設排序鍵
        order: 'desc'          // 預設排序方向 (descending)
    }
};

// 提供外部讀取狀態的方法
export function getState() {
    return state;
}

// 提供外部更新狀態的方法
export function setState(newState) {
    state = { ...state, ...newState };
}
