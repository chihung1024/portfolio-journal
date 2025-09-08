// =========================================================================================
// == 檔案：js/ui/utils.js (v_arch_cleanup_1)
// == 職責：提供 UI 渲染所需的通用輔助函式，並建立標準化的格式化工具
// =========================================================================================

import { getHoldings, getTransactions } from '../state.js';

let notificationTimeout;

/**
 * 顯示一個短暫的通知訊息
 * @param {string} message - 要顯示的訊息
 * @param {string} type - 'success', 'error', 'info'
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
 * @param {string | Date} date - 日期字串或 Date 物件
 * @returns {string} - 格式化後的日期
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
 * @param {number} value - 數值
 * @param {string} currency - 貨幣代碼 (TWD, USD)
 * @returns {string} - 格式化後的貨幣字串
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
 * 【新增】: 格式化通用數值
 * 此函式用於處理非貨幣類型的數字，如股數、百分比等，提供統一的格式化標準。
 * @param {number} value - 數值
 * @param {object} options - Intl.NumberFormat 的選項
 * @returns {string} - 格式化後的數字字串
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


/**
 * 根據股票代碼獲取其對應的貨幣
 * @param {string} symbol - 股票代碼
 * @returns {string} - 貨幣代碼
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
    formatNumber, // 【新增】: 導出新的格式化函式
    renderUI,
    getSymbolCurrency,
};

