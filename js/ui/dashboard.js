// ='========================================================================================
// == 儀表板 UI 模組 (dashboard.js) v2.0 - At-a-Glance Redesign
// =========================================================================================

import { formatNumber } from "./utils.js";

export function updateDashboard(currentHoldings, realizedPL, overallReturn, xirr) {
    const holdingsArray = Object.values(currentHoldings);
    const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
    const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
    const totalDailyPL = holdingsArray.reduce((sum, h) => sum + (h.daily_pl_twd || 0), 0);
    
    // 計算昨日收盤時的總市值
    const yesterdayTotalMarketValue = totalMarketValue - totalDailyPL;
    
    // 計算總體的當日報酬率
    const totalDailyReturnPercent = yesterdayTotalMarketValue !== 0 ? (totalDailyPL / yesterdayTotalMarketValue) * 100 : 0;

    // --- 【核心修改】 ---

    // 1. 總資產 (邏輯不變)
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);

    // 2. 當日損益 (全新渲染邏輯)
    const dailyPlPercentEl = document.getElementById('daily-pl-percent');
    const dailyPlAmountEl = document.getElementById('daily-pl-amount');
    const dailyPlContainerEl = document.getElementById('daily-pl-container');
    
    const dailyPlIsPositive = totalDailyPL >= 0;
    const dailyPlColor = dailyPlIsPositive ? 'text-red-600' : 'text-green-600';
    const dailyPlArrow = dailyPlIsPositive ? '<i data-lucide="trending-up" class="w-6 h-6 mr-1"></i>' : '<i data-lucide="trending-down" class="w-6 h-6 mr-1"></i>';

    dailyPlContainerEl.className = `mt-2 ${dailyPlColor}`;
    dailyPlPercentEl.innerHTML = `${dailyPlArrow}<span>${(totalDailyReturnPercent || 0).toFixed(2)}%</span>`;
    dailyPlAmountEl.textContent = formatNumber(totalDailyPL, 0);

    // 3. 未實現損益 (更新顏色邏輯)
    const unrealizedEl = document.getElementById('unrealized-pl');
    unrealizedEl.textContent = formatNumber(totalUnrealizedPL, 0);
    unrealizedEl.className = `text-3xl font-bold mt-2 ${totalUnrealizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    // 4. 已實現損益 (維持中性顏色)
    const realizedEl = document.getElementById('realized-pl');
    realizedEl.textContent = formatNumber(realizedPL, 0);
    // 顏色從紅綠改為固定的灰色，以體現其歷史屬性
    realizedEl.className = `text-3xl font-bold mt-2 text-gray-600`;
    
    // 5. 總報酬率 (全新渲染邏輯)
    const totalReturnEl = document.getElementById('total-return');
    const totalReturnIsPositive = (overallReturn || 0) >= 0;
    const totalReturnColor = totalReturnIsPositive ? 'text-red-600' : 'text-green-600';
    const totalReturnArrow = totalReturnIsPositive ? '<i data-lucide="trending-up" class="w-6 h-6 mr-1"></i>' : '<i data-lucide="trending-down" class="w-6 h-6 mr-1"></i>';

    totalReturnEl.className = `text-3xl font-bold flex items-center mt-2 ${totalReturnColor}`;
    totalReturnEl.innerHTML = `${totalReturnArrow}<span>${(overallReturn || 0).toFixed(2)}%</span>`;
    
    // 6. XIRR (全新渲染邏輯)
    const xirrEl = document.getElementById('xirr-value');
    const xirrIsPositive = (xirr || 0) >= 0;
    const xirrColor = xirrIsPositive ? 'text-red-600' : 'text-green-600';
    const xirrArrow = xirrIsPositive ? '<i data-lucide="trending-up" class="w-6 h-6 mr-1"></i>' : '<i data-lucide="trending-down" class="w-6 h-6 mr-1"></i>';
    
    xirrEl.className = `text-3xl font-bold flex items-center mt-2 ${xirrColor}`;
    xirrEl.innerHTML = `${xirrArrow}<span>${((xirr || 0) * 100).toFixed(2)}%</span>`;

    // 最後，確保所有新加入的 Lucide 圖示都被正確渲染
    lucide.createIcons();
}
