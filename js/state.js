// =========================================================================================
// == 狀態管理模組 (state.js) v4.2.0 - Closed Lots State
// =========================================================================================

// 應用程式的核心狀態
let state = {
    currentUserId: null,
    transactions: [],
    userSplits: [],
    marketDataForFrontend: {},
    pendingDividends: [],
    confirmedDividends: [],
    holdings: {},
    // ========================= 【核心修改 - 開始】 =========================
    closedLots: [], // 新增：用於儲存詳細的已平倉 FIFO 紀錄
    // ========================= 【核心修改 - 結束】 =========================
    isAppInitialized: false,
    chart: null,
    twrChart: null,
    netProfitChart: null, 
    confirmCallback: null,

    isSyncing: false,

    // 【新增】用於引導式流程的暫存數據
    tempTransactionData: null, // 儲存 { isEditing, txId, data: {...} }
    tempMembershipEdit: null, // 儲存 { txId }

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
