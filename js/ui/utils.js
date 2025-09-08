// =========================================================================================
// == 檔案：js/ui/utils.js (v_chart_refactor_1)
// == 職責：提供 UI 渲染所需的通用輔助函式，並為圖表模組提供標準化的日期過濾工具
// =========================================================================================

import { getHoldings, getTransactions } from '../state.js';

let notificationTimeout;

/**
 * 顯示一個短暫的通知訊息
 */
function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const typeClasses = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
    };

    const notification = document.createElement('div');
    notification.className = `fixed top-5 right-5 text-white p-4 rounded-lg shadow-lg z-50 transform transition-transform duration-300 translate-x-full ${typeClasses[type]}`;
    notification.textContent = message;

    container.appendChild(notification);

    setTimeout(() => {
        notification.classList.remove('translate-x-full');
    }, 10);

    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
    }

    notificationTimeout = setTimeout(() => {
        notification.classList.add('translate-x-full');
        notification.addEventListener('transitionend', () => notification.remove());
    }, 3000);
}

/**
 * 格式化日期為 YYYY-MM-DD
 */
function formatDate(date) {
    if (!date) return 'N/A';
    try {
        const d = new Date(date);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        console.error("日期格式化失敗:", date, e);
        return 'Invalid Date';
    }
}

/**
 * 格式化貨幣
 */
function formatCurrency(value, currency = 'TWD') {
    if (typeof value !== 'number' || !isFinite(value)) {
        return 'N/A';
    }
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    } catch (e) {
        return `${currency} ${value.toFixed(2)}`;
    }
}


/**
 * 格式化通用數值
 */
function formatNumber(value, options = {}) {
    if (typeof value !== 'number' || !isFinite(value)) {
        return 'N/A';
    }
    const defaults = {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        ...options
    };
    return new Intl.NumberFormat('en-US', defaults).format(value);
}

// ========================= 【圖表模組修正 - 開始】 =========================
/**
 * 根據指定的日期範圍過濾歷史數據
 * @param {object} history - { 'YYYY-MM-DD': value, ... } 格式的歷史數據
 * @param {string} range - '1M', '6M', 'YTD', '1Y', 'ALL'
 * @returns {object} - 過濾後的歷史數據
 */
function filterHistoryByDateRange(history, range) {
    if (!history || Object.keys(history).length === 0 || range === 'ALL') {
        return history || {};
    }

    const endDate = new Date();
    const startDate = new Date();
    
    switch (range) {
        case '1M':
            startDate.setMonth(endDate.getMonth() - 1);
            break;
        case '6M':
            startDate.setMonth(endDate.getMonth() - 6);
            break;
        case 'YTD':
            startDate.setMonth(0, 1); // 今年的 1 月 1 日
            startDate.setHours(0, 0, 0, 0);
            break;
        case '1Y':
            startDate.setFullYear(endDate.getFullYear() - 1);
            break;
        default:
            return history;
    }

    const filteredHistory = {};
    const startTimestamp = startDate.getTime();

    for (const dateStr in history) {
        const entryDate = new Date(dateStr);
        if (entryDate.getTime() >= startTimestamp) {
            filteredHistory[dateStr] = history[dateStr];
        }
    }
    return filteredHistory;
}
// ========================= 【圖表模組修正 - 結束】 =========================

/**
 * 根據股票代碼獲取其對應的貨幣
 */
function getSymbolCurrency(symbol) {
    const holdings = getHoldings();
    const transactions = getTransactions();
    const upperSymbol = symbol.toUpperCase();
    
    const holding = holdings.find(h => h.symbol.toUpperCase() === upperSymbol);
    if (holding && holding.currency) {
        return holding.currency;
    }

    const lastTransaction = transactions
        .filter(t => t.symbol.toUpperCase() === upperSymbol)
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (lastTransaction && lastTransaction.currency) {
        return lastTransaction.currency;
    }
    
    return /\.\w{2}$/.test(upperSymbol) ? 'TWD' : 'USD';
}


/**
 * 觸發一次完整的 UI 重新渲染
 */
function renderUI() {
    document.dispatchEvent(new CustomEvent('state-updated'));
}

export {
    showNotification,
    formatDate,
    formatCurrency,
    formatNumber,
    filterHistoryByDateRange, // <-- 導出新函式
    renderUI,
    getSymbolCurrency,
};

