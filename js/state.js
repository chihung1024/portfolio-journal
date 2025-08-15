// =========================================================================================
// == 狀態管理模組 (state.js) v3.6.0 - 新增群組管理狀態
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
    netProfitChart: null, 
    confirmCallback: null,

    isSyncing: false,

    // 【新增】群組相關狀態
    groups: [], // 存放所有使用者自訂的群組
    selectedGroupId: 'all', // 當前查看的群組ID, 'all' 代表全部股票

    // 篩選與排序狀態
    transactionFilter: 'all',
    transactionsPerPage: 15, 
    transactionsCurrentPage: 1, 
    dividendFilter: 'all',
    holdingsSort: {
        key: 'marketValueTWD',
        order: 'desc'
    },

    // 圖表相關狀態
    portfolioHistory: {},
    twrHistory: {},
    benchmarkHistory: {},
    netProfitHistory: {}, 
    assetDateRange: { type: 'all', start: null, end: null },
    twrDateRange: { type: 'all', start: null, end: null },
    netProfitDateRange: { type: 'all', start: null, end: null } 
};

// 提供外部讀取狀態的方法
export function getState() {
    return state;
}

// 提供外部更新狀態的方法
export function setState(newState) {
    state = { ...state, ...newState };
}
