// =========================================================================================
// == 平倉紀錄 UI 模組 (closedPositions.ui.js) - 【新檔案】
// == 職責：渲染平倉紀錄頁籤的內容，包括可展開的交易明細。
// =========================================================================================

import { getState } from '../../state.js';
import { formatNumber, isTwStock } from '../utils.js';

/**
 * 渲染單筆平倉紀錄的詳細交易明細 (子表格)
 * @param {object} position - 單一平倉紀錄物件 (包含 closedLots)
 * @returns {string} HTML string of the details card
 */
function renderClosedPositionDetails(position) {
    if (!position.closedLots || position.closedLots.length === 0) {
        return '<p class="text-center p-4 text-sm text-gray-500">沒有詳細的平倉批次紀錄。</p>';
    }

    // 內部函式，用於渲染單一批次的交易
    const renderLotTransactions = (transactions) => {
        const header = `
            <thead class="bg-gray-100">
                <tr>
                    <th class="px-2 py-1 text-left text-xs font-medium text-gray-600 uppercase">日期</th>
                    <th class="px-2 py-1 text-left text-xs font-medium text-gray-600 uppercase">類型</th>
                    <th class="px-2 py-1 text-right text-xs font-medium text-gray-600 uppercase">配對股數</th>
                    <th class="px-2 py-1 text-right text-xs font-medium text-gray-600 uppercase">價格</th>
                </tr>
            </thead>`;
        
        const body = transactions.map(tx => {
            const typeClass = tx.type === 'buy' ? 'text-red-700' : 'text-green-700';
            const typeText = tx.type === 'buy' ? '買入' : '賣出';
            return `
                <tr class="border-b border-gray-200">
                    <td class="px-2 py-1 whitespace-nowrap text-xs">${tx.date.split('T')[0]}</td>
                    <td class="px-2 py-1 font-semibold text-xs ${typeClass}">${typeText}</td>
                    <td class="px-2 py-1 text-right text-xs">${formatNumber(tx.usedQty, isTwStock(tx.symbol) ? 0 : 2)}</td>
                    <td class="px-2 py-1 text-right text-xs">${formatNumber(tx.price, 2)} <span class="text-gray-400">${tx.currency}</span></td>
                </tr>`;
        }).join('');

        return `<table class="min-w-full mt-2">${header}<tbody class="bg-white">${body}</tbody></table>`;
    };

    const lotsHtml = position.closedLots.map((lot, index) => {
        const returnClass = lot.realizedPL >= 0 ? 'text-red-600' : 'text-green-600';
        return `
            <div class="p-3 border rounded-md bg-white mb-3">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <div><p class="text-gray-500">平倉日</p><p class="font-medium">${lot.closingDate}</p></div>
                    <div><p class="text-gray-500">成本</p><p class="font-medium">${formatNumber(lot.costBasis, 0)}</p></div>
                    <div><p class="text-gray-500">收入</p><p class="font-medium">${formatNumber(lot.proceeds, 0)}</p></div>
                    <div><p class="text-gray-500">損益</p><p class="font-bold ${returnClass}">${formatNumber(lot.realizedPL, 0)}</p></div>
                </div>
                ${renderLotTransactions(lot.transactions)}
            </div>
        `;
    }).join('');

    return `
        <div class="p-4 bg-gray-50 border-t border-gray-200">
            <h4 class="font-bold text-gray-700 mb-2">FIFO 平倉批次明細：</h4>
            <div class="max-h-60 overflow-y-auto pr-2">
                ${lotsHtml}
            </div>
        </div>`;
}


/**
 * 渲染整個平倉紀錄表格
 */
export function renderClosedPositionsTable() {
    const { closedPositions, activeClosedPosition } = getState();
    const container = document.getElementById('closed-positions-tab');

    if (!container) return;

    if (!closedPositions || closedPositions.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">沒有已平倉的股票紀錄。</p>`;
        return;
    }

    const tableHeader = `
        <thead class="bg-gray-50">
            <tr>
                <th class="w-1/12 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase"></th>
                <th class="w-2/12 px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th>
                <th class="w-3/12 px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">總已實現損益 (TWD)</th>
                <th class="w-2/12 px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">總成本</th>
                <th class="w-2/12 px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">總收入</th>
                <th class="w-2/12 px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">報酬率</th>
            </tr>
        </thead>`;
    
    const tableBody = closedPositions.map(pos => {
        const isExpanded = activeClosedPosition === pos.symbol;
        const returnClass = pos.totalRealizedPL >= 0 ? 'text-red-600' : 'text-green-600';
        const returnRate = pos.totalCostBasis > 0 ? (pos.totalRealizedPL / pos.totalCostBasis) * 100 : 0;

        return `
            <tbody class="bg-white divide-y divide-gray-200">
                <tr class="closed-position-row cursor-pointer hover:bg-gray-100" data-symbol="${pos.symbol}">
                    <td class="px-2 py-4 whitespace-nowrap text-center">
                        <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}" class="w-5 h-5 text-gray-500"></i>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="font-medium text-base text-indigo-600">${pos.symbol}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-right">
                        <div class="font-semibold text-base ${returnClass}">${formatNumber(pos.totalRealizedPL, 0)}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-700">${formatNumber(pos.totalCostBasis, 0)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-700">${formatNumber(pos.totalProceeds, 0)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-right">
                        <div class="font-semibold text-sm ${returnClass}">${formatNumber(returnRate, 2)}%</div>
                    </td>
                </tr>
            </tbody>
            ${isExpanded ? `
                <tbody class="bg-white">
                    <tr>
                        <td colspan="6">
                            ${renderClosedPositionDetails(pos)}
                        </td>
                    </tr>
                </tbody>
            ` : ''}
        `;
    }).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
                ${tableHeader}
                ${tableBody}
            </table>
        </div>
    `;

    lucide.createIcons();
}
