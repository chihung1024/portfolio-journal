// js/ui/components/holdings.ui.js

import state from '../../state.js';
import { formatCurrency, formatPercentage } from '../utils.js';
import { setupDetailsModal } from './detailsModal.ui.js';

function getSortIndicator(key) {
    if (state.holdingsSort.key === key) {
        return state.holdingsSort.order === 'asc' ? ' ▲' : ' ▼';
    }
    return '';
}

export function renderHoldingsTable() {
    const holdings = state.holdings || [];
    const container = document.getElementById('holdings-table');
    if (!container) return;

    const sortedHoldings = [...holdings].sort((a, b) => {
        const { key, order } = state.holdingsSort;
        if (a[key] < b[key]) return order === 'asc' ? -1 : 1;
        if (a[key] > b[key]) return order === 'asc' ? 1 : -1;
        return 0;
    });

    const tableHTML = `
        <div class="table-container">
            <table class="min-w-full">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-4 py-2 text-left" data-sort-key="symbol">股票代號${getSortIndicator('symbol')}</th>
                        <th class="px-4 py-2 text-right" data-sort-key="quantity">持有股數${getSortIndicator('quantity')}</th>
                        <th class="px-4 py-2 text-right" data-sort-key="marketPrice">目前市價${getSortIndicator('marketPrice')}</th>
                        <th class="px-4 py-2 text-right" data-sort-key="averageCost">平均成本${getSortIndicator('averageCost')}</th>
                        <th class="px-4 py-2 text-right" data-sort-key="marketValue">總市值${getSortIndicator('marketValue')}</th>
                        <th class="px-4 py-2 text-right" data-sort-key="unrealizedProfit">未實現損益${getSortIndicator('unrealizedProfit')}</th>
                        <th class="px-4 py-2 text-right" data-sort-key="roi">報酬率${getSortIndicator('roi')}</th>
                        <th class="px-4 py-2 text-right" data-sort-key="portfolioPercentage">投資組合佔比${getSortIndicator('portfolioPercentage')}</th>
                        <th class="px-4 py-2 text-center">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedHoldings.map(holding => `
                        <tr class="border-b">
                            <td class="px-4 py-2 font-medium">${holding.symbol}</td>
                            <td class="px-4 py-2 text-right">${holding.quantity}</td>
                            <td class="px-4 py-2 text-right">${formatCurrency(holding.marketPrice)}</td>
                            <td class="px-4 py-2 text-right">${formatCurrency(holding.averageCost)}</td>
                            <td class="px-4 py-2 text-right">${formatCurrency(holding.marketValue)}</td>
                            <td class="px-4 py-2 text-right ${holding.unrealizedProfit >= 0 ? 'text-positive' : 'text-negative'}">
                                ${formatCurrency(holding.unrealizedProfit, true)}
                            </td>
                            <td class="px-4 py-2 text-right ${holding.roi >= 0 ? 'text-positive' : 'text-negative'}">
                                ${formatPercentage(holding.roi)}
                            </td>
                            <td class="px-4 py-2 text-right">${formatPercentage(holding.portfolioPercentage)}</td>
                            <td class="px-4 py-2 text-center">
                                <button class="details-btn text-blue-500 hover:text-blue-700" data-symbol="${holding.symbol}">
                                    <i data-lucide="info" class="w-5 h-5"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = tableHTML;
    lucide.createIcons();
    setupDetailsModal();
}
