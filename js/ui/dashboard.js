// =========================================================================================
// == 儀表板 UI 模組 (dashboard.js) v2.3 - Final Layout & Sizing
// == 職責：處理頂部儀表板數據卡片的更新。
// =========================================================================================

import { formatNumber } from "./utils.js";

// 【核心修改】移除所有 JS 字體調整邏輯，因為版面擴大後不再需要
// function adjustDailyPlFontSize() { ... }

function updateCard(mainElementId, value, options = {}) {
    const { secondaryElementId = null, secondaryValue = null, formatType = 'number', hasColor = false } = options;

    const mainEl = document.getElementById(mainElementId);
    if (!mainEl) return;

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

    if (secondaryElementId && secondaryValue !== null) {
        const secondaryEl = document.getElementById(secondaryElementId);
        if (secondaryEl) {
            secondaryEl.textContent = `${(secondaryValue || 0).toFixed(2)}%`;
        }
    }
    
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
    
    // 【核心修改】移除 JS 字體調整的呼叫
    // adjustDailyPlFontSize();
}
