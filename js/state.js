// =========================================================================================
// == 狀態管理模組 (state.js) v3.4.1 - 新增同步鎖
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
    holdings: {},
    isAppInitialized: false,
    chart: null,
    twrChart: null,
    confirmCallback: null,

    // [新增] 增加一個旗標來防止重複的數據同步
    isSyncing: false,

    // 篩選與排序狀態
    transactionFilter: 'all',
    dividendFilter: 'all',
    holdingsSort: {
        key: 'marketValueTWD',
        order: 'desc'
    },

    // 圖表相關狀態
    portfolioHistory: {},
    twrHistory: {},
    benchmarkHistory: {},
    assetDateRange: { type: 'all', start: null, end: null },
    twrDateRange: { type: 'all', start: null, end: null }
};

// 提供外部讀取狀態的方法
export function getState() {
    return state;
}

// 提供外部更新狀態的方法
export function setState(newState) {
    state = { ...state, ...newState };
}
