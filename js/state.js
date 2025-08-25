// =========================================================================================
// == 狀態管理模組 (state.js) v4.2.0 - Functional SetState
// =========================================================================================

// 應用程式的核心狀態
let state = {
    currentUserId: null,
    // transactions 陣列現在可能包含帶有 status 屬性的物件 (e.g., 'COMMITTED', 'STAGED_CREATE')
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

    hasStagedChanges: false, // 是否有未提交的變更
    isCommitting: false,     // 是否正在提交中

    // 用於引導式流程的暫存數據 (維持不變)
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

// ========================= 【核心修正 - 開始】 =========================
/**
 * 提供外部更新狀態的方法。
 * 現在支援「物件合併」與「函式更新」兩種模式。
 * @param {Object|Function} updater - 一個部分狀態物件，或是一個接收前一狀態並回傳部分狀態的函式。
 */
export function setState(updater) {
    // 根據 updater 是物件還是函式，來決定新的部分狀態
    const partialState = typeof updater === 'function' ? updater(state) : updater;

    // 處理副作用：如果 mobileViewMode 發生變化，則更新 localStorage
    if (partialState.mobileViewMode && partialState.mobileViewMode !== state.mobileViewMode) {
        localStorage.setItem('mobileViewMode', partialState.mobileViewMode);
    }

    // 將新的部分狀態合併回主狀態，完成更新
    state = { ...state, ...partialState };
}
// ========================= 【核心修正 - 結束】 =========================
