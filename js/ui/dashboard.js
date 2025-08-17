// =========================================================================================
// == 儀表板 UI 模組 (dashboard.js) v2.2 - Triptych Redesign
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

    // 1. Group 1: Asset Status (資產現況)
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);
    
    const unrealizedEl = document.getElementById('unrealized-pl');
    unrealizedEl.textContent = formatNumber(totalUnrealizedPL, 0);
    unrealizedEl.className = `text-3xl font-bold mt-2 text-right ${totalUnrealizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;

    // 2. Group 2: Live Performance (即時表現)
    const dailyPlEl = document.getElementById('daily-pl');
    const dailyPlPercentEl = document.getElementById('daily-pl-percent');
    const dailyPlCard = document.getElementById('daily-pl-card');
    const dailyPlColor = totalDailyPL >= 0 ? 'text-red-600' : 'text-green-600';
    const dailyPlBorderColor = totalDailyPL >= 0 ? 'border-red-500' : 'border-green-500';

    dailyPlEl.textContent = formatNumber(totalDailyPL, 0);
    dailyPlEl.className = `text-3xl font-bold ${dailyPlColor}`;
    dailyPlPercentEl.textContent = `${(totalDailyReturnPercent || 0).toFixed(2)}%`;
    dailyPlPercentEl.className = `text-base font-medium ${dailyPlColor}`;
    // 動態添加左側飾條
    dailyPlCard.style.borderLeft = `3px solid ${totalDailyPL >= 0 ? 'rgb(239 68 68)' : 'rgb(22 163 74)'}`;


    const totalReturnEl = document.getElementById('total-return');
    totalReturnEl.textContent = `${(overallReturn || 0).toFixed(2)}%`;
    // 稍微柔化顏色，避免與當日損益衝突
    totalReturnEl.className = `text-3xl font-bold mt-2 text-right ${overallReturn >= 0 ? 'text-red-500' : 'text-green-500'}`;
    
    // 3. Group 3: Historical & Analytical (歷史與分析)
    const realizedEl = document.getElementById('realized-pl');
    realizedEl.textContent = formatNumber(realizedPL, 0);
    // 使用中性的深灰色來呈現已實現的歷史數據
    realizedEl.className = `text-3xl font-bold mt-2 text-right text-gray-700`;

    const xirrEl = document.getElementById('xirr-value');
    xirrEl.textContent = `${((xirr || 0) * 100).toFixed(2)}%`;
    xirrEl.className = `text-3xl font-bold mt-2 text-right ${xirr >= 0 ? 'text-red-500' : 'text-green-500'}`;
}
