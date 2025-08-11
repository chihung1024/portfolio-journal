// =========================================================================================
// == 儀表板 UI 模組 (dashboard.js)
// == 職責：處理頂部儀表板數據卡片的更新。
// =========================================================================================

import { formatNumber } from "./utils.js";

export function updateDashboard(currentHoldings, realizedPL, overallReturn, xirr) {
    const holdingsArray = Object.values(currentHoldings);
    const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
    const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
    
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);
    
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
