// =========================================================================================
// == 交易紀錄 UI 模組 (transactions.ui.js) v3.0 - ATLAS-COMMIT Architecture
// =========================================================================================

import { getState } from '../../state.js';
import { isTwStock, formatNumber, findFxRateForFrontend } from '../utils.js';

/**
 * 產生智慧型自適應分頁控制項的 HTML (維持不變)
 */
function renderPaginationControls(totalItems, itemsPerPage, currentPage) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (totalPages <= 1) return '';

    let paginationHtml = '<div class="flex flex-wrap justify-center items-center gap-2 mt-4 transaction-pagination">';
    
    paginationHtml += `<button data-page="${currentPage - 1}" class="page-btn px-3 py-1 rounded-md text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}" ${currentPage === 1 ? 'disabled' : ''}>上一頁</button>`;

    let lastPageRendered = 0;
    for (let i = 1; i <= totalPages; i++) {
        const isFirstPage = i === 1;
        const isLastPage = i === totalPages;
        const isInContext = Math.abs(i - currentPage) <= 1;

        if (isFirstPage || isLastPage || isInContext) {
            if (i > lastPageRendered + 1) {
                paginationHtml += `<span class="px-3 py-1 text-sm text-gray-500">...</span>`;
            }
            
            const isActive = i === currentPage;
            paginationHtml += `<button data-page="${i}" class="page-btn px-3 py-1 rounded-md text-sm font-medium border ${isActive ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">${i}</button>`;
            lastPageRendered = i;
        }
    }

    paginationHtml += `<button data-page="${currentPage + 1}" class="page-btn px-3 py-1 rounded-md text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 ${currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''}" ${currentPage === totalPages ? 'disabled' : ''}>下一頁</button>`;
    paginationHtml += '</div>';
    return paginationHtml;
}

/**
 * [重大修改] 渲染交易紀錄表格
 */
export function renderTransactionsTable() {
    const { transactions, transactionFilter, transactionsPerPage, transactionsCurrentPage } = getState();
    const container = document.getElementById('transactions-tab');

    // 篩選器的數據源現在也來自包含暫存態的 transactions 列表
    const uniqueSymbols = ['all', ...Array.from(new Set(transactions.map(t => t.symbol)))];
    const filterHtml = `<div class="mb-4 flex items-center space-x-2"><label for="transaction-symbol-filter" class="text-sm font-medium text-gray-700">篩選股票:</label><select id="transaction-symbol-filter" class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">${uniqueSymbols.map(s => `<option value="${s}" ${transactionFilter === s ? 'selected' : ''}>${s === 'all' ? '顯示全部' : s}</option>`).join('')}</select></div>`;

    const filteredTransactions = transactionFilter === 'all' 
        ? transactions 
        : transactions.filter(t => t.symbol === transactionFilter);
    
    // 過濾掉被標記為 STAGED_DELETE 且不是 STAGED_CREATE 的項目，除非篩選器被選中
    // 簡單起見，暫時顯示所有，讓使用者清晰看到刪除線
    const displayTransactions = filteredTransactions;

    const startIndex = (transactionsCurrentPage - 1) * transactionsPerPage;
    const endIndex = startIndex + transactionsPerPage;
    const paginatedTransactions = displayTransactions.slice(startIndex, endIndex);

    const tableHtml = `<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">類型</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">股數</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">價格(原幣)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">總金額(TWD)</th><th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th></tr></thead><tbody id="transactions-table-body" class="bg-white divide-y divide-gray-200">${paginatedTransactions.length > 0 ? paginatedTransactions.map(t => {
        
        // --- [核心修改] 根據 status 決定樣式和內容 ---
        let rowClass = 'hover:bg-gray-50';
        let statusBadge = '';
        
        switch (t.status) {
            case 'STAGED_CREATE':
                rowClass = 'bg-green-50 hover:bg-green-100';
                statusBadge = '<span class="ml-2 text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-green-600 bg-green-200">待新增</span>';
                break;
            case 'STAGED_UPDATE':
                rowClass = 'bg-yellow-50 hover:bg-yellow-100';
                statusBadge = '<span class="ml-2 text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-yellow-800 bg-yellow-200">待修改</span>';
                break;
            case 'STAGED_DELETE':
                rowClass = 'bg-red-50 text-gray-400 line-through hover:bg-red-100';
                statusBadge = '<span class="ml-2 text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-red-600 bg-red-200">待刪除</span>';
                break;
            // 未來可以增加對 FAILED 狀態的處理
            // case 'FAILED':
            //     rowClass = 'bg-red-100 border-l-4 border-red-500';
            //     statusBadge = `<span class="... text-red-800 bg-red-200">失敗</span>`;
            //     break;
            default: // COMMITTED
                break;
        }

        const transactionDate = t.date.split('T')[0];
        const fxRate = t.exchangeRate || findFxRateForFrontend(t.currency, transactionDate);
        const totalAmountTWD = (t.totalCost || (t.quantity * t.price)) * fxRate;
        
        return `<tr class="${rowClass}">
            <td class="px-6 py-4 whitespace-nowrap">${transactionDate}</td>
            <td class="px-6 py-4 whitespace-nowrap font-medium">${t.symbol.toUpperCase()}${statusBadge}</td>
            <td class="px-6 py-4 whitespace-nowrap font-semibold ${t.type === 'buy' ? 'text-red-500' : 'text-green-500'}">${t.type === 'buy' ? '買入' : '賣出'}</td>
            <td class="px-6 py-4 whitespace-nowrap">${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td>
            <td class="px-6 py-4 whitespace-nowrap">${formatNumber(t.price)} <span class="text-xs text-gray-500">${t.currency}</span></td>
            <td class="px-6 py-4 whitespace-nowrap">${formatNumber(totalAmountTWD, 0)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                <button data-id="${t.id}" class="edit-btn text-indigo-600 hover:text-indigo-900 mr-3">編輯</button>
                <button data-id="${t.id}" class="delete-btn text-red-600 hover:text-red-900">刪除</button>
            </td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" class="text-center py-10 text-gray-500">沒有符合條件的交易紀錄。</td></tr>`}</tbody></table></div>`;
    
    const paginationControls = renderPaginationControls(displayTransactions.length, transactionsPerPage, transactionsCurrentPage);

    container.innerHTML = filterHtml + tableHtml + paginationControls;
}
