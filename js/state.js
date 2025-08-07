// =========================================================================================
// == 狀態管理模組 (state.js)
// =========================================================================================

// 應用程式的核心狀態
let state = {
    currentUserId: null,
    transactions: [],
    userSplits: [],
    stockNotes: {},
    marketDataForFrontend: {},
    pendingDividends: [],   // [新增] 待處理配息
    confirmedDividends: [], // [新增] 已確認配息
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
