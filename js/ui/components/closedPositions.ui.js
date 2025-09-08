// =========================================================================================
// == 檔案：js/ui/components/closedPositions.ui.js (v_arch_cleanup_4)
// == 職責：渲染已平倉部位的列表，並遵循正確的狀態管理與格式化規範
// =========================================================================================

import { getClosedPositions } from '../../state.js';
// 【核心修正】: 導入標準化的格式化工具
import { formatCurrency, formatNumber, formatDate } from '../utils.js';

/**
 * 渲染已平倉部位列表
 * @param {HTMLElement} container - 用於渲染內容的 HTML 元素
 */
function renderClosedPositions(container) {
    if (!container) return;

    const positions = getClosedPositions();

    if (!positions || positions.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 py-4">沒有已平倉的部位紀錄。</p>`;
        return;
    }

    const tableRows = positions.map(p => {
        const plClass = p.realized_pl_twd >= 0 ? 'text-green-500' : 'text-red-500';
        const returnRate = p.return_rate * 100;

        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 font-semibold">${p.symbol}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${formatDate(p.first_purchase_date)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${formatDate(p.last_sale_date)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatCurrency(p.cost_basis_twd, 'TWD')}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatCurrency(p.proceeds_twd, 'TWD')}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right ${plClass}">${formatCurrency(p.realized_pl_twd, 'TWD')}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right ${plClass}">${formatNumber(returnRate)}%</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full bg-white dark:bg-gray-800 text-sm">
                <thead class="bg-gray-100 dark:bg-gray-700">
                    <tr>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">代碼</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">首次買入</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">最終賣出</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">總成本 (TWD)</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">總收入 (TWD)</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">已實現損益</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">報酬率</th>
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
    renderClosedPositions
};
