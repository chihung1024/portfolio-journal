// =========================================================================================
// == 儀表板 UI 模組 (dashboard.js) v2.1 - Dynamic Font Sizing
// == 職責：處理頂部儀表板數據卡片的更新。
// =========================================================================================

import { formatNumber } from "./utils.js";

/**
 * 【新增】輔助函式：動態調整儀表板卡片的字體大小以防止溢出
 */
function adjustFontSize() {
    const metrics = document.querySelectorAll('.dashboard-metric');
    
    metrics.forEach(metric => {
        const container = metric.parentElement;
        // 先重置為最大字體，以便重新計算
        metric.classList.remove('text-2xl', 'text-xl');
        metric.classList.add('xl:text-3xl', 'text-2xl');

        // 檢查是否溢出，如果溢出則逐步降低字體大小
        if (metric.scrollWidth > container.clientWidth && container.clientWidth > 0) {
            metric.classList.remove('xl:text-3xl', 'text-2xl');
            metric.classList.add('text-xl');
        }
    });
}


/**
 * 輔助函式，用於更新單一數據卡片的內容與樣式
 * @param {string} mainElementId - 主要數值元素的 ID
 * @param {number|string} value - 要顯示的主要數值
 * @param {object} options - 其他選項
 */
function updateCard(mainElementId, value, options = {}) {
    const { secondaryElementId = null, secondaryValue = null, formatType = 'number', hasColor = false } = options;

    const mainEl = document.getElementById(mainElementId);
    if (!mainEl) return;

    // 格式化主要數值
    switch (formatType) {
        case 'number':
            mainEl.textContent = formatNumber(value, 0);
            break;
        case 'percent':
            mainEl.textContent = `${(value || 0).toFixed(2)}%`;
            break;
        case 'percent_xirr':
            mainEl.textContent = `${((value || 0) * 100).toFixed(2)}%`;
            break;
        default:
            mainEl.textContent = value;
    }

    // 更新次要數值 (如果有的話)
    if (secondaryElementId && secondaryValue !== null) {
        const secondaryEl = document.getElementById(secondaryElementId);
        if (secondaryEl) {
            secondaryEl.textContent = `${(secondaryValue || 0).toFixed(2)}%`;
        }
    }
    
    // 根據正負更新顏色
    if (hasColor) {
        const isPositive = (value || 0) >= 0;
        const colorClass = isPositive ? 'text-red-600' : 'text-green-600';
        const defaultColorClass = 'text-gray-800';

        const elementsToColor = [mainEl];
        if (secondaryElementId) elementsToColor.push(document.getElementById(secondaryElementId));
        
        elementsToColor.forEach(el => {
            if (el) {
                el.classList.remove('text-red-600', 'text-green-600', 'text-gray-800');
                el.classList.add(value !== 0 ? colorClass : defaultColorClass);
            }
        });
    }
}


export function updateDashboard(currentHoldings, realizedPL, overallReturn, xirr) {
    const holdingsArray = Object.values(currentHoldings);
    const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
    const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
    const totalDailyPL = holdingsArray.reduce((sum, h) => sum + (h.daily_pl_twd || 0), 0);
    
    const yesterdayTotalMarketValue = totalMarketValue - totalDailyPL;
    const totalDailyReturnPercent = yesterdayTotalMarketValue !== 0 ? (totalDailyPL / yesterdayTotalMarketValue) * 100 : 0;
    
    updateCard('total-assets', totalMarketValue, { formatType: 'number' });
    
    updateCard('daily-pl', totalDailyPL, { 
        secondaryElementId: 'daily-pl-percent', 
        secondaryValue: totalDailyReturnPercent,
        formatType: 'number', 
        hasColor: true 
    });

    updateCard('unrealized-pl', totalUnrealizedPL, { formatType: 'number', hasColor: true });
    
    updateCard('realized-pl', realizedPL, { formatType: 'number', hasColor: true });
    
    updateCard('total-return', overallReturn, { formatType: 'percent', hasColor: true });
    
    updateCard('xirr-value', xirr, { formatType: 'percent_xirr', hasColor: true });
    
    // 【核心修改】在所有卡片更新完畢後，呼叫字體大小調整函式
    adjustFontSize();
}
