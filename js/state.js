
// =========================================================================================
// == 狀態管理模組 (state.js) v4.2.0 - Nested Collapse State
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
    isAppInitialized: false,
    chart: null,
    twrChart: null,
    netProfitChart: null, 
    confirmCallback: null,

    isSyncing: false,

    // 用於引導式流程的暫存數據
    tempTransactionData: null, // 儲存 { isEditing, txId, data: {...} }
    tempMembershipEdit: null, // 儲存 { txId }

    // 群組相關狀態
    groups: [],
    selectedGroupId: 'all',

    // 平倉紀錄相關狀態
    closedPositions: [],
    // ========================= 【核心修改 - 開始】 =========================
    // 升級資料結構以支援巢狀摺疊。
    // null: 全部收合
    // { symbol: 'QQQ', expandedSales: new Set() }: QQQ 已展開，但其下的平倉交易全部收合
    // { symbol: 'QQQ', expandedSales: new Set(['2025-04-23']) }: QQQ 已展開，且 4/23 的平倉交易也已展開
    activeClosedPosition: null,
    // ========================= 【核心修改 - 結束】 =========================


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
