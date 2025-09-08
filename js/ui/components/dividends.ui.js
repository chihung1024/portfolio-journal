// =========================================================================================
// == 檔案：js/ui/components/dividends.ui.js (v_e2e_fix_4)
// == 職責：渲染「配息」頁籤的 UI 介面，包括已確認與待確認的配息列表
// =========================================================================================

import { getDividends, getPendingDividends } from '../../state.js';
import { formatDate, formatCurrency, showNotification } from '../utils.js';
import { openModal } from '../modals.js';
import { addDividend } from '../../api.js';

/**
 * 渲染待確認的配息列表
 */
function renderPendingDividends() {
    const pendingDividends = getPendingDividends();
    const container = document.getElementById('pending-dividends-content');
    if (!container) return;

    // 【核心修正】: 增加無資料時的 UI 提示，提升使用者體驗
    if (!pendingDividends || pendingDividends.length === 0) {
        container.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-check-circle fa-3x text-green-500 mb-3"></i>
                <p class="text-gray-500">太棒了！目前沒有待辦事項。</p>
            </div>
        `;
        return;
    }
    
    const tableRows = pendingDividends.map(div => {
        const totalAmount = div.quantity_at_ex_date * div.amount_per_share;
        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${div.symbol}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${formatDate(div.ex_dividend_date)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatCurrency(div.amount_per_share, div.currency)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${div.quantity_at_ex_date.toFixed(2)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatCurrency(totalAmount, div.currency)}</td>
                <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-center">
                    <button class="confirm-pending-dividend-btn text-green-500 hover:text-green-700" data-symbol="${div.symbol}" data-ex-date="${div.ex_dividend_date}" data-amount="${div.amount_per_share}" data-currency="${div.currency}">
                        <i class="fas fa-check-circle"></i> 確認
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full bg-white dark:bg-gray-800">
                <thead class="bg-gray-100 dark:bg-gray-700">
                    <tr>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">代碼</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">除息日</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">每股配息</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">持有股數</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">預估總額</th>
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


/**
 * 渲染已確認的配息列表
 */
function renderConfirmedDividends() {
    const dividends = getDividends();
    const container = document.getElementById('confirmed-dividends-list');
    if (!container) return;

    if (!dividends || dividends.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 py-4">沒有已確認的配息紀錄。</p>`;
        return;
    }

    const listItems = dividends.map(div => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${div.symbol}</td>
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${formatDate(div.ex_dividend_date)}</td>
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${formatDate(div.payment_date)}</td>
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">${formatCurrency(div.total_amount, div.currency)}</td>
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-center">
                <button class="edit-dividend-btn text-blue-500 hover:text-blue-700 mr-2" data-id='${div.id}'><i class="fas fa-edit"></i></button>
                <button class="delete-dividend-btn text-red-500 hover:text-red-700" data-id='${div.id}'><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full bg-white dark:bg-gray-800">
                <thead class="bg-gray-100 dark:bg-gray-700">
                    <tr>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">代碼</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">除息日</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">發放日</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-right">總額</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-center">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${listItems}
                </tbody>
            </table>
        </div>
    `;
}

// 導出模組
export { renderPendingDividends, renderConfirmedDividends };
