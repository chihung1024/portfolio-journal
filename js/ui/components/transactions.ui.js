// =========================================================================================
// == 檔案：js/ui/components/transactions.ui.js (v_arch_final_fix)
// == 職責：渲染交易列表，並嚴格遵循「後端為唯一可信資料來源」的架構原則
// =========================================================================================

import { getTransactions } from '../../state.js';
import { formatDate, formatCurrency } from '../utils.js';

/**
 * 渲染交易列表
 * @param {HTMLElement} container - 用於渲染內容的 HTML 元素
 */
function renderTransactions(container) {
    if (!container) return;

    const transactions = getTransactions();

    if (!transactions || transactions.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 py-4">沒有交易紀錄。</p>`;
        return;
    }

    const tableRows = transactions.map(tx => {
        const typeClass = tx.type === 'buy' ? 'text-green-500' : 'text-red-500';
        const typeText = tx.type === 'buy' ? '買入' : '賣出';
        
        // 【核心修正】: 移除所有前端計算邏輯。
        // 原先此處存在 quantity * price_per_share 的前端計算，現已廢除。
        // 我們現在直接使用由後端計算並提供的權威數據 `tx.total_twd`。
        const totalTWD = tx.total_twd;

        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${formatDate(tx.date)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${tx.symbol}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 ${typeClass}">${typeText}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${tx.quantity.toFixed(4)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatCurrency(tx.price_per_share, tx.currency)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatCurrency(totalTWD, 'TWD')}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-center">
                    <button class="edit-transaction-btn text-blue-500 hover:text-blue-700 mr-2" data-id='${tx.id}'><i class="fas fa-edit"></i></button>
                    <button class="delete-transaction-btn text-red-500 hover:text-red-700" data-id='${tx.id}'><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full bg-white dark:bg-gray-800 text-sm">
                <thead class="bg-gray-100 dark:bg-gray-700">
                    <tr>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">日期</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">代碼</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">類型</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">股數</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">價格</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">總額 (TWD)</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-center">操作</th>
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
    renderTransactions
};
