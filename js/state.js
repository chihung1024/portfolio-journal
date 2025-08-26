// =========================================================================================
// == 狀態管理模組 (state.js) v5.0.0 — 集中式暫存區（Staging）版
// == 角色：全站唯一的前端狀態入口，含「暫存區」與持久化；其餘模組一律經由此處讀寫
// =========================================================================================

// --- 可持久化鍵值（LocalStorage）
const LS_KEYS = {
  MOBILE_VIEW_MODE: 'mobileViewMode',
  STAGED_CHANGES: 'stagedChanges',
};

// --- 預設狀態（僅此處定義，嚴禁在其他模組擴增 state 結構）
const defaultState = {
  // 使用者/應用
  currentUserId: null,
  isAppInitialized: false,
  activeTab: 'dashboard', // dashboard | transactions | holdings | dividends | splits | settings
  chart: null,
  mobileViewMode: (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEYS.MOBILE_VIEW_MODE)) || 'table',

  // 資料快取（後端主檔）
  transactions: [],
  userSplits: [],
  stockNotes: {},
  marketDataForFrontend: {},
  pendingDividends: [],
  confirmedDividends: [],
  holdings: {},

  // 即時計算/快取
  lastSyncedAt: null, // ISO string

  // === 暫存區（Staging） ===
  stagedChanges: loadStagedChanges(), // 來源：LocalStorage
  isCommitting: false,
  // 衍生狀態（由 stagedChanges 推導）
  hasStagedChanges: false,
};

// --- 實際狀態容器
let state = applyDerived({ ...defaultState });

// 訂閱者（觀察者）
const subscribers = new Set();

// =========================================================================================
// == 公開 API
// =========================================================================================

export function getState() {
  return state;
}

/**
 * 合併更新狀態；
 * - 自動處理：mobileViewMode / stagedChanges 的持久化
 * - 自動推導：hasStagedChanges
 * - 觸發訂閱者通知
 */
export function setState(partial) {
  const prev = state;
  const next = { ...state, ...partial };

  // 依賴 LocalStorage 的持久化欄位
  if (Object.prototype.hasOwnProperty.call(partial, 'mobileViewMode')) {
    safeSetLocalStorage(LS_KEYS.MOBILE_VIEW_MODE, next.mobileViewMode);
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'stagedChanges')) {
    safeSetLocalStorage(LS_KEYS.STAGED_CHANGES, JSON.stringify(next.stagedChanges || []));
  }

  state = applyDerived(next);

  // 通知監聽者
  for (const fn of subscribers) {
    try { fn(state, prev); } catch (err) { console.error('[state] subscriber error:', err); }
  }
}

/**
 * 訂閱狀態變更；回傳解除訂閱函式
 */
export function subscribe(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

// =========================================================================================
// == 暫存區便利函式（提供給 staging 模組與 UI 橫幅使用）
// =========================================================================================

/** 將一筆變更推入暫存區 */
export function pushStagedChange(change) {
  const list = Array.isArray(state.stagedChanges) ? [...state.stagedChanges] : [];
  list.push({ ...change });
  setState({ stagedChanges: list });
}

/** 以 id 移除暫存變更 */
export function removeStagedChange(id) {
  const list = (state.stagedChanges || []).filter(c => c.id !== id);
  setState({ stagedChanges: list });
}

/** 清空暫存區 */
export function clearStagedChanges() {
  setState({ stagedChanges: [] });
}

/** 設定提交中狀態（UI 會自動根據 isCommitting 顯示/鎖定） */
export function setCommitting(flag) {
  setState({ isCommitting: !!flag });
}

// =========================================================================================
// == 內部工具
// =========================================================================================

function applyDerived(next) {
  // 推導 hasStagedChanges
  next.hasStagedChanges = Array.isArray(next.stagedChanges) && next.stagedChanges.length > 0;
  return next;
}

function loadStagedChanges() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LS_KEYS.STAGED_CHANGES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[state] failed to load stagedChanges from LS:', err);
    return [];
  }
}

function safeSetLocalStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch (err) {
    // 忽略 Safari 無痕模式等錯誤
    console.warn('[state] localStorage set failed:', err);
  }
}

// =========================================================================================
// == 初始化：確保初始衍生狀態正確
// =========================================================================================
state = applyDerived(state);
