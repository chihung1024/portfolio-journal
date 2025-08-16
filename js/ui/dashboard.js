// =========================================================================================
// == 儀表板 UI 模組 (dashboard.js)
// == 職責：處理頂部儀表板數據卡片的更新。
// =========================================================================================

import { formatNumber } from "./utils.js";
import { getColorSettings } from '../settings.js'; // 【新增】引入顏色設定

export function updateDashboard(currentHoldings, realizedPL, overallReturn, xirr) {
    const colorSettings = getColorSettings(); // 【新增】獲取當前顏色主題
    const holdingsArray = Object.values(currentHoldings);
    const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
    const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
    const totalDailyPL = holdingsArray.reduce((sum, h) => sum + (h.daily_pl_twd || 0), 0);
    
    const yesterdayTotalMarketValue = totalMarketValue - totalDailyPL;
    const totalDailyReturnPercent = yesterdayTotalMarketValue !== 0 ? (totalDailyPL / yesterdayTotalMarketValue) * 100 : 0;
    
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);
    
    const dailyPlEl = document.getElementById('daily-pl');
    dailyPlEl.innerHTML = `
        ${formatNumber(totalDailyPL, 0)}
        <span class="text-lg ml-2 font-medium">${(totalDailyReturnPercent || 0).toFixed(2)}%</span>
    `;
    // 【修改】使用動態顏色 Class
    dailyPlEl.className = `text-3xl font-bold mt-2 ${totalDailyPL >= 0 ? colorSettings.gain : colorSettings.loss}`;
    
    const unrealizedEl = document.getElementById('unrealized-pl');
    unrealizedEl.textContent = formatNumber(totalUnrealizedPL, 0);
    // 【修改】使用動態顏色 Class
    unrealizedEl.className = `text-3xl font-bold mt-2 ${totalUnrealizedPL >= 0 ? colorSettings.gain : colorSettings.loss}`;
    
    const realizedEl = document.getElementById('realized-pl');
    realizedEl.textContent = formatNumber(realizedPL, 0);
    // 【修改】使用動態顏色 Class
    realizedEl.className = `text-3xl font-bold mt-2 ${realizedPL >= 0 ? colorSettings.gain : colorSettings.loss}`;
    
    const totalReturnEl = document.getElementById('total-return');
    totalReturnEl.textContent = `${(overallReturn || 0).toFixed(2)}%`;
    // 【修改】使用動態顏色 Class
    totalReturnEl.className = `text-3xl font-bold mt-2 ${overallReturn >= 0 ? colorSettings.gain : colorSettings.loss}`;
    
    const xirrEl = document.getElementById('xirr-value');
    xirrEl.textContent = `${((xirr || 0) * 100).toFixed(2)}%`;
    // 【修改】使用動態顏色 Class
    xirrEl.className = `text-3xl font-bold mt-2 ${xirr >= 0 ? colorSettings.gain : colorSettings.loss}`;
}
