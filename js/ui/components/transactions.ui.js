// =========================================================================================
// == 交易紀錄 UI 模組 (transactions.ui.js)
// == 職責：處理交易紀錄表格的渲染。
// =========================================================================================

import { getState } from '../../state.js';
import { isTwStock, formatNumber, findFxRateForFrontend } from '../utils.js';

export function renderTransactionsTable() {
    const { transactions, transactionFilter } = getState();
    const container = document.getElementById('transactions-tab');
    const uniqueSymbols = ['all', ...Array.from(new Set(transactions.map(t => t.symbol)))];
    const filterHtml = `<div class="mb-4 flex items-center space-x-2"><label for="transaction-symbol-filter" class="text-sm font-medium text-gray-700">篩選股票:</label><select id="transaction-symbol-filter" class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">${uniqueSymbols.map(s => `<option value="${s}" ${transactionFilter === s ? 'selected' : ''}>${s === 'all' ? '顯示全部' : s}</option>`).join('')}</select></div>`;
    const filteredTransactions = transactionFilter === 'all' ? transactions : transactions.filter(t => t.symbol === transactionFilter);
    const tableHtml = `<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">類型</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">股數</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">價格(原幣)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">總金額(TWD)</th><th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th></tr></thead><tbody id="transactions-table-body" class="bg-white divide-y divide-gray-200">${filteredTransactions.length > 0 ? filteredTransactions.map(t => { const transactionDate = t.date.split('T')[0]; const fxRate = t.exchangeRate || findFxRateForFrontend(t.currency, transactionDate); const totalAmountTWD = (t.totalCost || (t.quantity * t.price)) * fxRate; return `<tr class="hover:bg-gray-50"><td class="px-6 py-4">${transactionDate}</td><td class="px-6 py-4 font-medium">${t.symbol.toUpperCase()}</td><td class="px-6 py-4 font-semibold ${t.type === 'buy' ? 'text-red-500' : 'text-green-500'}">${t.type === 'buy' ? '買入' : '賣出'}</td><td class="px-6 py-4">${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td><td class="px-6 py-4">${formatNumber(t.price)} <span class="text-xs text-gray-500">${t.currency}</span></td><td class="px-6 py-4">${formatNumber(totalAmountTWD, 0)}</td><td class="px-6 py-4 text-center text-sm font-medium"><button data-id="${t.id}" class="edit-btn text-indigo-600 hover:text-indigo-900 mr-3">編輯</button><button data-id="${t.id}" class="delete-btn text-red-600 hover:text-red-900">刪除</button></td></tr>`; }).join('') : `<tr><td colspan="7" class="text-center py-10 text-gray-500">沒有符合條件的交易紀錄。</td></tr>`}</tbody></table></div>`;
    container.innerHTML = filterHtml + tableHtml;
}
