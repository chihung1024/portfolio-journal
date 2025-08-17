// =========================================================================================
// == 儀表板 UI 模組 (dashboard.js) v2.1 - Visual Decluttering
// =========================================================================================

import { formatNumber } from "./utils.js";

export function updateDashboard(currentHoldings, realizedPL, overallReturn, xirr) {
    const holdingsArray = Object.values(currentHoldings);
    const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
    const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
    const totalDailyPL = holdingsArray.reduce((sum, h) => sum + (h.daily_pl_twd || 0), 0);
    
    const yesterdayTotalMarketValue = totalMarketValue - totalDailyPL;
    const totalDailyReturnPercent = yesterdayTotalMarketValue !== 0 ? (totalDailyPL / yesterdayTotalMarketValue) * 100 : 0;

    // --- 【核心修改】 ---

    // 1. 總資產
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);

    // 2. 當日損益 (新渲染邏輯)
    const dailyPlEl = document.getElementById('daily-pl');
    const dailyPlPercentEl = document.getElementById('daily-pl-percent');
    const dailyPlColor = totalDailyPL >= 0 ? 'text-red-600' : 'text-green-600';
    
    dailyPlEl.textContent = formatNumber(totalDailyPL, 0);
    dailyPlEl.className = `text-3xl font-bold ${dailyPlColor}`;
    
    dailyPlPercentEl.textContent = `${(totalDailyReturnPercent || 0).toFixed(2)}%`;
    dailyPlPercentEl.className = `text-xl font-medium ${dailyPlColor}`;

    // 3. 未實現損益
    const unrealizedEl = document.getElementById('unrealized-pl');
    unrealizedEl.textContent = formatNumber(totalUnrealizedPL, 0);
    unrealizedEl.className = `text-3xl font-bold mt-2 ${totalUnrealizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    // 4. 已實現損益
    const realizedEl = document.getElementById('realized-pl');
    realizedEl.textContent = formatNumber(realizedPL, 0);
    // 維持較為中性的顏色
    realizedEl.className = `text-3xl font-bold mt-2 ${realizedPL >= 0 ? 'text-gray-800' : 'text-gray-500'}`;
    
    // 5. 總報酬率
    const totalReturnEl = document.getElementById('total-return');
    totalReturnEl.textContent = `${(overallReturn || 0).toFixed(2)}%`;
    totalReturnEl.className = `text-3xl font-bold mt-2 ${overallReturn >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    // 6. XIRR
    const xirrEl = document.getElementById('xirr-value');
    xirrEl.textContent = `${((xirr || 0) * 100).toFixed(2)}%`;
    xirrEl.className = `text-3xl font-bold mt-2 ${xirr >= 0 ? 'text-red-600' : 'text-green-600'}`;
}
