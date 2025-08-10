// =========================================================================================
// == 狀態管理模組 (state.js) v3.5.0 - 新增群組狀態
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

    // 【新增】群組功能相關狀態
    groups: [], // 儲存所有群組的列表
    selectedGroupId: '_all_', // 當前選擇的群組ID，預設為全部
    isGroupView: false, // 當前是否為群組檢視模式
    fullPortfolioData: null, // 用於快取「全部持股」的數據

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
