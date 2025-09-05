// js/ui/components/transactions.ui.js

import state from '../../state.js';
import { formatCurrency } from '../utils.js';

export function renderTransactionsTable() {
    const transactions = state.transactions || [];
    const container = document.getElementById('transactions-table');
    if (!container) return;

    // Apply filters
    const filteredTransactions = transactions.filter(t => {
        const { symbol, type, startDate, endDate } = state.transactionFilter;
        const symbolMatch = !symbol || t.symbol.toLowerCase().includes(symbol.toLowerCase());
        const typeMatch = !type || t.type === type;
        const startDateMatch = !startDate || new Date(t.date) >= new Date(startDate);
        const endDateMatch = !endDate || new Date(t.date) <= new Date(endDate);
        return symbolMatch && typeMatch && startDateMatch && endDateMatch;
    });

    // Sort by date descending
    const sortedTransactions = [...filteredTransactions].sort((a, b) => new Date(b.date) - new Date(a.date));

    const tableBody = container.querySelector('tbody');
    if (!tableBody) {
        console.error('Transactions table body not found');
        return;
    }

    if (sortedTransactions.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4">沒有符合條件的交易紀錄。</td></tr>';
        return;
    }

    tableBody.innerHTML = sortedTransactions.map(transaction => `
        <tr class="border-b" data-id="${transaction.id}">
            <td class="px-4 py-2">${transaction.date}</td>
            <td class="px-4 py-2 font-medium">${transaction.symbol}</td>
            <td class="px-4 py-2">
                <span class="px-2 py-1 text-xs rounded-full ${transaction.type === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                    ${transaction.type === 'buy' ? '買入' : '賣出'}
                </span>
            </td>
            <td class="px-4 py-2 text-right">${transaction.quantity}</td>
            <td class="px-4 py-2 text-right">${formatCurrency(transaction.price)}</td>
            <td class="px-4 py-2 text-right">
                <button class="edit-transaction-btn text-blue-500 hover:text-blue-700 p-1">
                    <i data-lucide="edit" class="w-4 h-4"></i>
                </button>
                <button class="delete-transaction-btn text-red-500 hover:text-red-700 p-1">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </td>
        </tr>
    `).join('');

    lucide.createIcons();
}
