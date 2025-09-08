// =========================================================================================
// == 檔案：js/state.js (v_arch_revert)
// == 職責：管理前端應用的全域狀態，並移除 getState 以鞏固狀態封裝原則
// =========================================================================================

// 全局狀態物件，儲存從 API 獲取的所有數據
const state = {
    isAuthenticated: false,
    user: null,
    holdings: [],
    summary: {},
    transactions: [],
    splits: [],
    dividends: [],
    groups: [],
    closedPositions: [],
    pendingDividends: [],
    isLoading: true,
    isRecalculating: false,
    error: null,
};

// =========================================================================================
// == Getters - 提供對 state 安全的唯讀訪問
// =========================================================================================

const getHoldings = () => state.holdings || [];
const getSummary = () => state.summary || {};
const getTransactions = () => state.transactions || [];
const getSplits = () => state.splits || [];
const getDividends = () => state.dividends || [];
const getGroups = () => state.groups || [];
const getClosedPositions = () => state.closedPositions || [];
const getPendingDividends = () => state.pendingDividends || [];
const getUser = () => state.user;
const getIsLoading = () => state.isLoading;
const getIsRecalculating = () => state.isRecalculating;

// =========================================================================================
// == Setters - 更新 state 並觸發 UI 重新渲染
// =========================================================================================

/**
 * 設置並更新整個投資組合的數據
 * @param {object} portfolioData - 從 /api/portfolio 獲取的完整數據包
 */
function setPortfolio(portfolioData) {
    state.holdings = portfolioData.holdings || [];
    state.summary = portfolioData.summary || {};
    state.transactions = portfolioData.transactions || [];
    state.splits = portfolioData.splits || [];
    state.dividends = portfolioData.dividends || [];
    state.groups = portfolioData.groups || [];
    state.closedPositions = portfolioData.closedPositions || [];
    state.pendingDividends = portfolioData.pendingDividends || [];
}

function setIsLoading(isLoading) {
    state.isLoading = isLoading;
    document.dispatchEvent(new CustomEvent('state-updated'));
}

function setIsRecalculating(isRecalculating) {
    state.isRecalculating = isRecalculating;
    document.dispatchEvent(new CustomEvent('state-updated'));
}

function setAuth({ isAuthenticated, user }) {
    state.isAuthenticated = isAuthenticated;
    state.user = user;
}

// 導出模組
export {
    state,
    getHoldings,
    getSummary,
    getTransactions,
    getSplits,
    getDividends,
    getPendingDividends,
    getGroups,
    getClosedPositions,
    getUser,
    getIsLoading,
    getIsRecalculating,
    setPortfolio,
    setIsLoading,
    setIsRecalculating,
    setAuth,
};

