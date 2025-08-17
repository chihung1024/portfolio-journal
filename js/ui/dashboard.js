// =========================================================================================
// == 儀表板 UI 模組 (dashboard.js)
// == 職責：處理頂部儀表板數據卡片的更新。
// =========================================================================================

import { formatNumber } from "./utils.js";

export function updateDashboard(currentHoldings, realizedPL, overallReturn, xirr) {
    const holdingsArray = Object.values(currentHoldings);
    const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
    const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
    const totalDailyPL = holdingsArray.reduce((sum, h) => sum + (h.daily_pl_twd || 0), 0);
    
    // ================== 【新增/修改的程式碼開始】 ==================

    // 1. 計算昨日收盤時的總市值
    const yesterdayTotalMarketValue = totalMarketValue - totalDailyPL;
    
    // 2. 計算總體的當日報酬率
    const totalDailyReturnPercent = yesterdayTotalMarketValue !== 0 ? (totalDailyPL / yesterdayTotalMarketValue) * 100 : 0;

    // ================== 【新增/修改的程式碼結束】 ==================
    
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);
    
    const dailyPlEl = document.getElementById('daily-pl');
    
    // 3. 更新顯示內容，同時包含金額與百分比
    dailyPlEl.innerHTML = `
        ${formatNumber(totalDailyPL, 0)}
        <span class="text-lg ml-2 font-medium">${(totalDailyReturnPercent || 0).toFixed(2)}%</span>
    `;
    dailyPlEl.className = `text-3xl font-bold mt-2 ${totalDailyPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    const unrealizedEl = document.getElementById('unrealized-pl');
    unrealizedEl.textContent = formatNumber(totalUnrealizedPL, 0);
    unrealizedEl.className = `text-3xl font-bold mt-2 ${totalUnrealizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    const realizedEl = document.getElementById('realized-pl');
    realizedEl.textContent = formatNumber(realizedPL, 0);
    realizedEl.className = `text-3xl font-bold mt-2 ${realizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    const totalReturnEl = document.getElementById('total-return');
    totalReturnEl.textContent = `${(overallReturn || 0).toFixed(2)}%`;
    totalReturnEl.className = `text-3xl font-bold mt-2 ${overallReturn >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    const xirrEl = document.getElementById('xirr-value');
    xirrEl.textContent = `${((xirr || 0) * 100).toFixed(2)}%`;
    xirrEl.className = `text-3xl font-bold mt-2 ${xirr >= 0 ? 'text-red-600' : 'text-green-600'}`;
}
