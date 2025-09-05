// js/ui/components/detailsModal.ui.js

import { getStockDetails } from '../../api.js';
import { showModal, hideModal } from '../modals.js';
import { formatCurrency, formatPercentage } from '../utils.js';
import state from '../../state.js';

export function setupDetailsModal() {
    const holdingsTable = document.getElementById('holdings-table');
    if (holdingsTable) {
        holdingsTable.addEventListener('click', async (event) => {
            const detailsButton = event.target.closest('.details-btn');
            if (detailsButton) {
                const symbol = detailsButton.dataset.symbol;
                showModal('details-modal');
                renderStockDetails(symbol); 
            }
        });
    }

    const detailsModal = document.getElementById('details-modal');
    if (detailsModal) {
        detailsModal.addEventListener('click', (event) => {
            if (event.target.matches('.close-btn, .close-btn *')) {
                hideModal('details-modal');
            }
        });
    }
}


async function renderStockDetails(symbol) {
    const modalTitle = document.getElementById('details-modal-title');
    const modalBody = document.getElementById('details-modal-body');

    modalTitle.textContent = `Loading details for ${symbol}...`;
    modalBody.innerHTML = '<div class="loading-spinner"></div>';

    try {
        const details = await getStockDetails(symbol);
        const holding = state.holdings.find(h => h.symbol === symbol);

        modalTitle.textContent = `${details.name} (${symbol})`;
        modalBody.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-gray-50 p-4 rounded-lg">
                    <h3 class="text-lg font-bold text-gray-800 mb-3 border-b pb-2">當前持股狀況</h3>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">持有股數:</span> <span>${holding.quantity}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">平均成本:</span> <span>${formatCurrency(holding.averageCost)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">目前市價:</span> <span>${formatCurrency(holding.marketPrice)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">總成本:</span> <span>${formatCurrency(holding.totalCost)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">總市值:</span> <span>${formatCurrency(holding.marketValue)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">未實現損益:</span> <span class="${holding.unrealizedProfit > 0 ? 'text-positive' : 'text-negative'}">${formatCurrency(holding.unrealizedProfit, true)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">報酬率:</span> <span class="${holding.unrealizedProfit > 0 ? 'text-positive' : 'text-negative'}">${formatPercentage(holding.roi)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">投資組合佔比:</span> <span>${formatPercentage(holding.portfolioPercentage)}</span></div>
                    </div>
                </div>

                <div class="bg-gray-50 p-4 rounded-lg">
                    <h3 class="text-lg font-bold text-gray-800 mb-3 border-b pb-2">市場資訊</h3>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">開盤價:</span> <span>${formatCurrency(details.open)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">最高價:</span> <span>${formatCurrency(details.high)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">最低價:</span> <span>${formatCurrency(details.low)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">昨日收盤價:</span> <span>${formatCurrency(details.previousClose)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">成交量:</span> <span>${details.volume.toLocaleString()}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">市值:</span> <span>${(details.marketCap / 1e9).toFixed(2)}B</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">52週高點:</span> <span>${formatCurrency(details.fiftyTwoWeekHigh)}</span></div>
                        <div class="flex justify-between"><span class="font-semibold text-gray-600">52週低點:</span> <span>${formatCurrency(details.fiftyTwoWeekLow)}</span></div>
                    </div>
                </div>
            </div>

            <div class="mt-6">
                <h3 class="text-lg font-bold text-gray-800 mb-3 border-b pb-2">相關交易紀錄</h3>
                <div class="max-h-60 overflow-y-auto">
                    <table class="min-w-full text-sm">
                        <thead class="bg-gray-100">
                            <tr>
                                <th class="text-left p-2">日期</th>
                                <th class="text-left p-2">類型</th>
                                <th class="text-right p-2">股數</th>
                                <th class="text-right p-2">價格</th>
                                <th class="text-right p-2">總金額</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white">
                            ${state.transactions.filter(t => t.symbol === symbol).map(t => `
                                <tr class="border-b">
                                    <td class="p-2">${t.date}</td>
                                    <td class="p-2"><span class="px-2 py-1 rounded ${t.type === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${t.type}</span></td>
                                    <td class="text-right p-2">${t.quantity}</td>
                                    <td class="text-right p-2">${formatCurrency(t.price)}</td>
                                    <td class="text-right p-2">${formatCurrency(t.quantity * t.price)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (error) {
        modalBody.innerHTML = `<p class="text-red-500">Could not load details for ${symbol}. ${error.message}</p>`;
    }
}
