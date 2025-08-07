// =========================================================================================
// == 狀態管理模組 (state.js) v2.8.2
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
    isAppInitialized: false, // [新增] App 初始化狀態旗標
    chart: null,
    twrChart: null,
    confirmCallback: null
};

// 提供外部讀取狀態的方法
export function getState() {
    return state;
}

// 提供外部更新狀態的方法
export function setState(newState) {
    state = { ...state, ...newState };
}
