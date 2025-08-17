// =========================================================================================
// == 狀態管理模組 (state.js) v3.7.1 - 調整行動裝置預設視圖
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

    // 群組相關狀態
    groups: [],
    selectedGroupId: 'all',

    // 行動裝置 UI 狀態
    // 【修改】將預設值從 'card' 改為 'list'
    mobileViewMode: localStorage.getItem('mobileViewMode') || 'list', // 'card' or 'list'
    activeMobileHolding: null, // 儲存當前在 list 模式下展開的股票代碼

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
    // 如果 mobileViewMode 改變，則將其儲存到 localStorage
    if (newState.mobileViewMode && newState.mobileViewMode !== state.mobileViewMode) {
        localStorage.setItem('mobileViewMode', newState.mobileViewMode);
    }
    state = { ...state, ...newState };
}
