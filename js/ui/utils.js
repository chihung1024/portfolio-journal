// =========================================================================================
// == 前端 UI 工具函式模組 (utils.js)
// == 職責：提供整個 UI 層可重用的、與 DOM 渲染無直接關係的輔助函式。
// =========================================================================================

import { getState } from '../state.js';

/**
 * 判斷一個股票代碼是否為台股 (.TW or .TWO)
 */
export function isTwStock(symbol) {
    return symbol ? symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO') : false;
}

/**
 * 將數字格式化為帶有千分位和指定小數位數的字串
 */
export function formatNumber(value, decimals = 2) {
    const num = Number(value);
    if (isNaN(num)) return decimals === 0 ? '0' : '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * [前端專用] 根據日期字串尋找對應的匯率
 */
export function findFxRateForFrontend(currency, dateStr) {
    const { marketDataForFrontend } = getState();
    if (currency === 'TWD') return 1;

    const currencyToFx_FE = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
    const fxSym = currencyToFx_FE[currency];
    if (!fxSym || !marketDataForFrontend[fxSym]) return 1;

    const rates = marketDataForFrontend[fxSym].rates || {};
    if (rates[dateStr]) return rates[dateStr];

    let nearestDate = null;
    for (const rateDate in rates) {
        if (rateDate <= dateStr && (!nearestDate || rateDate > nearestDate)) {
            nearestDate = rateDate;
        }
    }
    return nearestDate ? rates[nearestDate] : 1;
}

/**
 * 根據預設或自訂的日期範圍，過濾歷史數據
 */
export function filterHistoryByDateRange(history, dateRange) {
    if (!history || Object.keys(history).length === 0) {
        return {};
    }

    const sortedDates = Object.keys(history).sort();
    const endDate = dateRange.type === 'custom' && dateRange.end ? new Date(dateRange.end) : new Date(sortedDates[sortedDates.length - 1]);
    let startDate;

    switch (dateRange.type) {
        case 'ytd':
            startDate = new Date(endDate.getFullYear(), 0, 1);
            break;
        case '1m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 1);
            break;
        case '3m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 3);
            break;
        case '6m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 6);
            break;
        case '1y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 1);
            break;
        case '3y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 3);
            break;
        case '5y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 5);
            break;
        case 'custom':
            startDate = dateRange.start ? new Date(dateRange.start) : new Date(sortedDates[0]);
            break;
        case 'all':
        default:
            startDate = new Date(sortedDates[0]);
            break;
    }

    const filteredHistory = {};
    for (const dateStr of sortedDates) {
        const currentDate = new Date(dateStr);
        if (currentDate >= startDate && currentDate <= endDate) {
            filteredHistory[dateStr] = history[dateStr];
        }
    }
    return filteredHistory;
}

/**
 * 根據預設的日期範圍，計算出實際的開始與結束日期字串 (YYYY-MM-DD)
 */
export function getDateRangeForPreset(history, dateRange) {
    if (!history || Object.keys(history).length === 0) {
        return { startDate: '', endDate: '' };
    }
    const toYYYYMMDD = (date) => date.toISOString().split('T')[0];

    const sortedDates = Object.keys(history).sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];

    const endDate = dateRange.type === 'custom' && dateRange.end ? new Date(dateRange.end) : new Date(lastDate);
    let startDate;

    switch (dateRange.type) {
        case 'ytd':
            startDate = new Date(endDate.getFullYear(), 0, 1);
            break;
        case '1m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 1);
            break;
        case '3m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 3);
            break;
        case '6m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 6);
            break;
        case '1y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 1);
            break;
        case '3y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 3);
            break;
        case '5y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 5);
            break;
        case 'all':
        default:
            startDate = new Date(firstDate);
            break;
    }

    if (startDate < new Date(firstDate)) {
        startDate = new Date(firstDate);
    }

    return {
        startDate: toYYYYMMDD(startDate),
        endDate: toYYYYMMDD(endDate)
    };
}
