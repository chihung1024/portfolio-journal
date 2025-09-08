// =========================================================================================
// == 檔案：js/api.js (v_api_cleanup_2)
// == 職責：封裝所有與後端 API 的通訊，並為「群組」管理提供標準化介面
// =========================================================================================

import { setPortfolio, setIsLoading, setIsRecalculating } from './state.js';
import { renderUI, showNotification } from './ui/utils.js';
import { getToken } from './auth.js';

const API_BASE_URL = '/api';

/**
 * 執行 API 請求的通用函式
 * @param {string} endpoint - API 端點路徑
 * @param {object} options - fetch 函式的選項
 * @returns {Promise<object>} - 解析後的 JSON 回應
 * @throws {Error} - 當網路回應不 ok 時拋出錯誤
 */
async function fetchAPI(endpoint, options = {}) {
    const token = await getToken();
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'API request failed with no error body' }));
        console.error(`API Error: ${response.status} ${response.statusText}`, errorData);
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }
    // 允許沒有回傳內容的 204 No Content 回應
    if (response.status === 204) {
        return {};
    }
    return response.json();
}

/**
 * 獲取並更新整個投資組合的數據
 */
async function getPortfolio() {
    try {
        setIsLoading(true);
        const data = await fetchAPI('/portfolio');
        setPortfolio(data);
    } catch (error) {
        console.error('Failed to get portfolio:', error);
        showNotification('無法載入投資組合數據，請稍後再試。', 'error');
    } finally {
        setIsLoading(false);
        renderUI();
    }
}

/**
 * 觸發後端執行一次完整的重算
 */
async function recalculatePortfolio() {
    try {
        setIsRecalculating(true);
        showNotification('正在同步您的最新交易...', 'info');
        await new Promise(resolve => setTimeout(resolve, 500)); 
        await fetchAPI('/portfolio/recalculate', { method: 'POST' });
        await getPortfolio();
        showNotification('數據同步完成！', 'success');
    } catch (error) {
        console.error('Failed to recalculate portfolio:', error);
        showNotification('數據同步失敗，請稍後再試。', 'error');
    } finally {
        setIsRecalculating(false);
    }
}

// ... [交易, 分割, 股息的 API 函式保持不變] ...

async function addTransaction(transactionData) {
    await fetchAPI('/transactions', {
        method: 'POST',
        body: JSON.stringify(transactionData),
    });
    await recalculatePortfolio(); 
}

async function updateTransaction(id, transactionData) {
    await fetchAPI(`/transactions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(transactionData),
    });
    await recalculatePortfolio();
}

async function deleteTransaction(id) {
    await fetchAPI(`/transactions/${id}`, { method: 'DELETE' });
    await recalculatePortfolio();
}

async function addSplit(splitData) {
    await fetchAPI('/splits', {
        method: 'POST',
        body: JSON.stringify(splitData),
    });
    await recalculatePortfolio();
}

async function updateSplit(id, splitData) {
    await fetchAPI(`/splits/${id}`, {
        method: 'PUT',
        body: JSON.stringify(splitData),
    });
    await recalculatePortfolio();
}

async function deleteSplit(id) {
    await fetchAPI(`/splits/${id}`, { method: 'DELETE' });
    await recalculatePortfolio();
}

async function addDividend(dividendData) {
    await fetchAPI('/dividends', {
        method: 'POST',
        body: JSON.stringify(dividendData),
    });
    await recalculatePortfolio();
}

async function updateDividend(id, dividendData) {
    await fetchAPI(`/dividends/${id}`, {
        method: 'PUT',
        body: JSON.stringify(dividendData),
    });
    await recalculatePortfolio();
}

async function deleteDividend(id) {
    await fetchAPI(`/dividends/${id}`, { method: 'DELETE' });
    await recalculatePortfolio();
}

// ========================= 【核心修正 - 開始】 =========================
/**
 * 新增一個群組
 * @param {object} groupData - { name: string, symbols: string[] }
 */
async function addGroup(groupData) {
    await fetchAPI('/groups', {
        method: 'POST',
        body: JSON.stringify(groupData),
    });
    await getPortfolio(); // 依後端規範，僅刷新數據，不觸發重算
}

/**
 * 更新一個現有的群組
 * @param {string} id - 群組 ID
 * @param {object} groupData - { name: string, symbols: string[] }
 */
async function updateGroup(id, groupData) {
    await fetchAPI(`/groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify(groupData),
    });
    await getPortfolio(); // 依後端規範，僅刷新數據，不觸發重算
}

/**
 * 刪除一個群組
 * @param {string} id - 群組 ID
 */
async function deleteGroup(id) {
    await fetchAPI(`/groups/${id}`, { method: 'DELETE' });
    await getPortfolio(); // 依後端規範，僅刷新數據，不觸發重算
}
// ========================= 【核心修正 - 結束】 =========================

async function forceRecalculate() {
    try {
        setIsRecalculating(true);
        showNotification('正在執行強制完整重算...', 'info');
        await fetchAPI('/portfolio/recalculate?force=true', { method: 'POST' });
        await getPortfolio();
        showNotification('強制重算完成！', 'success');
    } catch (error) {
        console.error('Failed to force recalculate portfolio:', error);
        showNotification('強制重算失敗，請檢查後端日誌。', 'error');
    } finally {
        setIsRecalculating(false);
    }
}

// 導出模組
export {
    getPortfolio,
    recalculatePortfolio,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addSplit,
    updateSplit,
    deleteSplit,
    addDividend,
    updateDividend,
    deleteDividend,
    addGroup,      // <-- 導出新函式
    updateGroup,   // <-- 導出新函式
    deleteGroup,   // <-- 導出新函式
    forceRecalculate,
};

