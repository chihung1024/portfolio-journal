// =========================================================================================
// == 狀態管理模組 (state.js) v3.4.0
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

    // 篩選與排序狀態
    transactionFilter: 'all',
    dividendFilter: 'all',
    holdingsSort: {
        key: 'marketValueTWD',
        order: 'desc'
    },

    // [新增] 圖表相關狀態
    portfolioHistory: {}, // 儲存完整的資產成長歷史
    twrHistory: {},       // 儲存完整的 TWR 歷史
    benchmarkHistory: {}, // 儲存完整的 Benchmark 歷史
    assetDateRange: { type: 'all', start: null, end: null }, // 資產圖表時間區間
    twrDateRange: { type: 'all', start: null, end: null }    // TWR 圖表時間區間
};

// 提供外部讀取狀態的方法
export function getState() {
    return state;
}

// 提供外部更新狀態的方法
export function setState(newState) {
    state = { ...state, ...newState };
}
