// =========================================================================================
// == 狀態管理模組 (state.js) v5.0.0 - 支援細粒度載入狀態
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

    // 【核心修改】引入細粒度的載入狀態管理
    isLoading: {
        summary: true, // 初始摘要
        holdings: true, // 持股列表
        charts: true,   // 圖表數據
        secondaryData: true, // 交易、股利等次要數據
        committing: false, // 是否正在提交變更 (例如：儲存交易)
    },

    // 用於請求中止，確保數據一致性
    activeDataRequestController: null,

    // 用於引導式流程的暫存數據
    tempTransactionData: null,
    tempMembershipEdit: null,

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
