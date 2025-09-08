// =========================================================================================
// == 檔案：js/ui/components/holdings.ui.js (v_arch_cleanup_3)
// == 職責：渲染主要的持股列表，並遵循正確的狀態管理與格式化規範
// =========================================================================================

import { getHoldings } from '../../state.js';
// 【核心修正】: 導入標準化的格式化工具
import { formatCurrency, formatNumber } from '../utils.js';

/**
 * 渲染持股列表
 * @param {HTMLElement} container - 用於渲染內容的 HTML 元素
 */
function renderHoldings(container) {
    if (!container) return;

    const holdings = getHoldings();

    if (!holdings || holdings.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 py-4">沒有持股紀錄。</p>`;
        return;
    }

    const tableRows = holdings.map(h => {
        const plClass = h.unrealizedPLTWD >= 0 ? 'text-green-500' : 'text-red-500';
        const dailyPlClass = h.daily_pl_twd >= 0 ? 'text-green-500' : 'text-red-500';
        const dailyChangeSign = h.daily_pl_twd >= 0 ? '+' : '';
        const returnRate = h.returnRate * 100;

        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer view-details-btn" data-symbol="${h.symbol}">
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 font-semibold">${h.symbol}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatNumber(h.quantity, {maximumFractionDigits: 4})}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatCurrency(h.marketValueTWD, 'TWD')}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right ${plClass}">${formatCurrency(h.unrealizedPLTWD, 'TWD')}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right ${plClass}">${formatNumber(returnRate)}%</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right ${dailyPlClass}">
                    <div>${dailyChangeSign}${formatCurrency(h.daily_pl_twd, 'TWD')}</div>
                    <div class="text-xs">(${dailyChangeSign}${formatNumber(h.daily_change_percent * 100)}%)</div>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full bg-white dark:bg-gray-800 text-sm">
                <thead class="bg-gray-100 dark:bg-gray-700">
                    <tr>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">代碼</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">股數</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">市值 (TWD)</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">未實現損益</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">報酬率</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">當日損益</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
}

export {
    renderHoldings
};
