// =========================================================================================
// == 交易紀錄 UI 模組 (transactions.ui.js) v2.1 - 支援微觀編輯入口
// =========================================================================================

import { getState } from '../../state.js';
import { isTwStock, formatNumber, findFxRateForFrontend } from '../utils.js';

/**
 * 產生智慧型自適應分頁控制項的 HTML
 * @param {number} totalItems - 總項目數
 * @param {number} itemsPerPage - 每頁項目數
 * @param {number} currentPage - 當前頁碼
 * @returns {string} - 分頁控制項的 HTML 字串
 */
function renderPaginationControls(totalItems, itemsPerPage, currentPage) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (totalPages <= 1) return ''; // 如果只有一頁或沒有，則不顯示分頁

    let paginationHtml = '<div class="flex flex-wrap justify-center items-center gap-2 mt-4 transaction-pagination">';
    
    // 上一頁按鈕
    paginationHtml += `<button data-page="${currentPage - 1}" class="page-btn px-3 py-1 rounded-md text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}" ${currentPage === 1 ? 'disabled' : ''}>上一頁</button>`;

    let lastPageRendered = 0;
    for (let i = 1; i <= totalPages; i++) {
        const isFirstPage = i === 1;
        const isLastPage = i === totalPages;
        const isInContext = Math.abs(i - currentPage) <= 1; // 顯示當前頁的前後1頁

        if (isFirstPage || isLastPage || isInContext) {
            // 如果當前頁與上一頁之間有間隔，則插入省略號
            if (i > lastPageRendered + 1) {
                paginationHtml += `<span class="px-3 py-1 text-sm text-gray-500">...</span>`;
            }
            
            const isActive = i === currentPage;
            paginationHtml += `<button data-page="${i}" class="page-btn px-3 py-1 rounded-md text-sm font-medium border ${isActive ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">${i}</button>`;
            lastPageRendered = i;
        }
    }

    // 下一頁按鈕
    paginationHtml += `<button data-page="${currentPage + 1}" class="page-btn px-3 py-1 rounded-md text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''}" ${currentPage === totalPages ? 'disabled' : ''}>下一頁</button>`;

    paginationHtml += '</div>';
    return paginationHtml;
}


export function renderTransactionsTable() {
    const { transactions, transactionFilter, transactionsPerPage, transactionsCurrentPage } = getState();
    const container = document.getElementById('transactions-tab');

    const uniqueSymbols = ['all', ...Array.from(new Set(transactions.map(t => t.symbol)))];
    const filterHtml = `<div class="mb-4 flex items-center space-x-2"><label for="transaction-symbol-filter" class="text-sm font-medium text-gray-700">篩選股票:</label><select id="transaction-symbol-filter" class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">${uniqueSymbols.map(s => `<option value="${s}" ${transactionFilter === s ? 'selected' : ''}>${s === 'all' ? '顯示全部' : s}</option>`).join('')}</select></div>`;

    const filteredTransactions = transactionFilter === 'all' ? transactions : transactions.filter(t => t.symbol === transactionFilter);
    
    const startIndex = (transactionsCurrentPage - 1) * transactionsPerPage;
    const endIndex = startIndex + transactionsPerPage;
    const paginatedTransactions = filteredTransactions.slice(startIndex, endIndex);

    const tableHtml = `<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">類型</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">股數</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">價格(原幣)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">總金額(TWD)</th><th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th></tr></thead><tbody id="transactions-table-body" class="bg-white divide-y divide-gray-200">${paginatedTransactions.length > 0 ? paginatedTransactions.map(t => {
        const transactionDate = t.date.split('T')[0];
        const fxRate = t.exchangeRate || findFxRateForFrontend(t.currency, transactionDate);
        const totalAmountTWD = (t.totalCost || (t.quantity * t.price)) * fxRate;
        // 【核心修改】在操作欄位中新增 "編輯群組" 按鈕
        return `<tr class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap">${transactionDate}</td>
            <td class="px-6 py-4 whitespace-nowrap font-medium">${t.symbol.toUpperCase()}</td>
            <td class="px-6 py-4 whitespace-nowrap font-semibold ${t.type === 'buy' ? 'text-red-500' : 'text-green-500'}">${t.type === 'buy' ? '買入' : '賣出'}</td>
            <td class="px-6 py-4 whitespace-nowrap">${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td>
            <td class="px-6 py-4 whitespace-nowrap">${formatNumber(t.price)} <span class="text-xs text-gray-500">${t.currency}</span></td>
            <td class="px-6 py-4 whitespace-nowrap">${formatNumber(totalAmountTWD, 0)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                <button data-id="${t.id}" class="edit-btn text-indigo-600 hover:text-indigo-900 mr-3">編輯</button>
                <button data-id="${t.id}" class="edit-membership-btn text-teal-600 hover:text-teal-900 mr-3">編輯群組</button>
                <button data-id="${t.id}" class="delete-btn text-red-600 hover:text-red-900">刪除</button>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" class="text-center py-10 text-gray-500">沒有符合條件的交易紀錄。</td></tr>`}</tbody></table></div>`;
    
    const paginationControls = renderPaginationControls(filteredTransactions.length, transactionsPerPage, transactionsCurrentPage);

    container.innerHTML = filterHtml + tableHtml + paginationControls;
}
