// =========================================================================================
// == 狀態管理模組 (state.js)
// =========================================================================================

let state = {
  currentUserId: null,
  transactions: [],
  userSplits: [],
  manualDividends: [],    // ← 股息專用
  stockNotes: {},
  marketDataForFrontend: {},
  chart: null,
  twrChart: null,
  confirmCallback: null
};

export function getState() {
  return state;
}

export function setState(newState) {
  state = { ...state, ...newState };
}
