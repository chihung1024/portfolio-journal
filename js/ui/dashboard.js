// =========================================================================================
// == 儀表板 UI 模組 (dashboard.js) v2.0 - UI & Responsiveness Refined
// == 職責：處理頂部儀表板數據卡片的更新。
// =========================================================================================

import { formatNumber } from "./utils.js";

/**
 * [新增] 輔助函式，用於更新單一數據卡片的內容與樣式
 * @param {string} mainElementId - 主要數值元素的 ID
 * @param {number|string} value - 要顯示的主要數值
 * @param {object} options - 其他選項
 * @param {string|null} secondaryElementId - (可選) 次要數值元素 (如百分比) 的 ID
 * @param {number|string|null} secondaryValue - (可選) 要顯示的次要數值
 * @param {string} formatType - 'number', 'percent', 'percent_xirr'
 * @param {boolean|null} hasColor - 數值是否需要根據正負顯示不同顏色
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
    
    // ================== 【計算邏輯不變】 ==================
    const yesterdayTotalMarketValue = totalMarketValue - totalDailyPL;
    const totalDailyReturnPercent = yesterdayTotalMarketValue !== 0 ? (totalDailyPL / yesterdayTotalMarketValue) * 100 : 0;
    
    // ================== 【修改的程式碼開始】 ==================
    
    // 使用新的輔助函式更新所有卡片
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
    
    // ================== 【修改的程式碼結束】 ==================
}

export async function updateDashboardStaleIndicators() {
    const cardIds = ['total-assets', 'daily-pl', 'unrealized-pl', 'realized-pl', 'total-return', 'xirr-value'];
    try {
        const actions = await stagingService.getActions();
        const hasStagedActions = actions.length > 0;

        for (const cardId of cardIds) {
            const mainEl = document.getElementById(cardId);
            if (!mainEl) continue;

            let indicator = mainEl.parentNode.querySelector('.stale-indicator');

            if (hasStagedActions) {
                if (!indicator) {
                    indicator = document.createElement('span');
                    indicator.className = 'stale-indicator text-primary small ms-1';
                    indicator.textContent = '(變更待提交)';
                    mainEl.parentNode.appendChild(indicator);
                }
            } else {
                if (indicator) {
                    indicator.remove();
                }
            }
        }
    } catch (error) {
        console.error("Failed to update dashboard stale indicators:", error);
    }
}
