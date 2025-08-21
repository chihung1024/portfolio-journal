// =========================================================================================
// == 狀態管理模組 (state.js) v5.0.0 - 支援 ATLAS-COMMIT 架構
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

    // 【新增】ATLAS-COMMIT 架構所需的核心狀態
    hasStagedChanges: false, // 是否有任何未提交的變更
    stagedChanges: [],       // 在前端樂觀更新的操作紀錄
    isCommitting: false,     // 是否正在提交變更 (用於鎖定 UI)

    // 【移除】舊的、分散的暫存數據，由 stagedChanges 統一管理
    // tempTransactionData: null, 
    // tempMembershipEdit: null,

    // 群組相關狀態
    groups: [],
    selectedGroupId: 'all',

    // 行動裝置 UI 狀態
    mobileViewMode: localStorage.getItem('mobileViewMode') || 'list',
    activeMobileHolding: null,

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
    if (newState.mobileViewMode && newState.mobileViewMode !== state.mobileViewMode) {
        localStorage.setItem('mobileViewMode', newState.mobileViewMode);
    }
    state = { ...state, ...newState };
}
