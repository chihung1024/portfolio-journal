// =========================================================================================
// == 平倉紀錄 UI 模組 (closedPositions.ui.js) - v2.0 (UI/UX Overhauled)
// == 職責：渲染平倉紀錄頁籤的內容，包括可展開的交易明細。
// =========================================================================================

import { getState } from '../../state.js';
import { formatNumber, isTwStock } from '../utils.js';

/**
 * 輔助函式：計算兩個日期之間的天數差異
 * @param {string} dateStr1 - YYYY-MM-DD 格式的日期字串
 * @param {string} dateStr2 - YYYY-MM-DD 格式的日期字串
 * @returns {number} 兩個日期之間的天數
 */
function calculateHoldingDays(dateStr1, dateStr2) {
    const date1 = new Date(dateStr1);
    const date2 = new Date(dateStr2);
    const differenceInTime = date2.getTime() - date1.getTime();
    return Math.round(differenceInTime / (1000 * 3600 * 24));
}


/**
 * 渲染單筆平倉紀錄的詳細交易明細 (子表格)
 * @param {object} position - 單一平倉紀錄物件 (包含 closedLots)
 * @returns {string} HTML string of the details card
 */
function renderClosedPositionDetails(position) {
    if (!position.closedLots || position.closedLots.length === 0) {
        return '<div class="px-6 py-5 bg-slate-50 border-t"><p class="text-center text-sm text-gray-500">沒有詳細的平倉批次紀錄。</p></div>';
    }

    // 依據賣出日期，將所有配對好的買入批次進行分組
    const lotsBySellDate = position.closedLots.reduce((acc, lot) => {
        const sellTx = lot.transactions.find(t => t.type === 'sell');
        if (!sellTx) return acc;

        const sellDate = sellTx.date.split('T')[0];
        if (!acc[sellDate]) {
            acc[sellDate] = {
                sellTransaction: sellTx,
                matchedBuys: [],
                totalCostBasis: 0,
                totalProceeds: 0,
            };
        }
        
        const buyTxs = lot.transactions.filter(t => t.type === 'buy');
        acc[sellDate].matchedBuys.push(...buyTxs);
        acc[sellDate].totalCostBasis += lot.costBasis;
        acc[sellDate].totalProceeds += lot.proceeds;
        
        return acc;
    }, {});

    const sellBlocksHtml = Object.entries(lotsBySellDate).map(([sellDate, data]) => {
        const { sellTransaction, matchedBuys, totalCostBasis, totalProceeds } = data;
        const realizedPL = totalProceeds - totalCostBasis;
        const returnRate = totalCostBasis > 0 ? (realizedPL / totalCostBasis) * 100 : 0;
        const returnClass = realizedPL >= 0 ? 'text-red-600' : 'text-green-600';
        
        const avgHoldingDays = matchedBuys.reduce((sum, buy) => {
            const holdingDays = calculateHoldingDays(buy.date.split('T')[0], sellDate);
            return sum + (holdingDays * buy.usedQty);
        }, 0) / matchedBuys.reduce((sum, buy) => sum + buy.usedQty, 1);


        const buysHtml = matchedBuys.map(buy => `
            <div class="grid grid-cols-12 gap-2 text-xs items-center py-1.5 px-2">
                <div class="col-span-3 text-gray-600">${buy.date.split('T')[0]}</div>
                <div class="col-span-3 text-right text-gray-800">${formatNumber(buy.usedQty, isTwStock(buy.symbol) ? 0 : 4)}</div>
                <div class="col-span-3 text-right text-gray-800">${formatNumber(buy.price, 2)}</div>
                <div class="col-span-3 text-right text-gray-600">${calculateHoldingDays(buy.date.split('T')[0], sellDate)} 天</div>
            </div>
        `).join('<hr class="border-gray-100">');

        return `
            <div class="border border-gray-200 rounded-lg overflow-hidden mb-4 bg-white shadow-sm">
                <div class="bg-gray-50 p-3">
                    <div class="flex justify-between items-center">
                        <div>
                            <span class="text-xs font-medium text-gray-500 bg-gray-200 px-2 py-0.5 rounded">賣出日期</span>
                            <span class="ml-2 font-semibold text-gray-800">${sellDate}</span>
                        </div>
                        <div class="text-right">
                            <p class="text-sm font-medium text-green-600">賣出 ${formatNumber(sellTransaction.quantity, isTwStock(sellTransaction.symbol) ? 0 : 2)} 股 @ ${formatNumber(sellTransaction.price, 2)}</p>
                        </div>
                    </div>
                </div>
                
                <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm p-3 border-b border-gray-200">
                    <div><p class="text-gray-500 text-xs">總成本 (TWD)</p><p class="font-medium text-sm">${formatNumber(totalCostBasis, 0)}</p></div>
                    <div><p class="text-gray-500 text-xs">總收入 (TWD)</p><p class="font-medium text-sm">${formatNumber(totalProceeds, 0)}</p></div>
                    <div class="md:col-span-2"><p class="text-gray-500 text-xs">平均持有天期</p><p class="font-medium text-sm">${avgHoldingDays.toFixed(0)} 天</p></div>
                    <div class="text-right"><p class="text-gray-500 text-xs">損益 (TWD)</p><p class="font-bold text-lg ${returnClass}">${formatNumber(realizedPL, 0)} (${formatNumber(returnRate, 2)}%)</p></div>
                </div>

                <div>
                    <div class="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 bg-gray-50 py-1 px-2 border-b border-gray-200">
                        <div class="col-span-3">買入日期</div>
                        <div class="col-span-3 text-right">配對股數</div>
                        <div class="col-span-3 text-right">成本價</div>
                        <div class="col-span-3 text-right">持有天期</div>
                    </div>
                    <div class="max-h-32 overflow-y-auto no-scrollbar">
                        ${buysHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="px-4 sm:px-6 py-5 bg-slate-50/70 border-t border-gray-200">
            <h4 class="font-bold text-gray-700 mb-3 text-base">平倉交易故事線：</h4>
            ${sellBlocksHtml}
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
                <th class="w-10 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase"></th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">總已實現損益 (TWD)</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">報酬率</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">平均持有天期</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">總交易次數</th>
            </tr>
        </thead>`;
    
    const tableBody = closedPositions.map(pos => {
        const isExpanded = activeClosedPosition === pos.symbol;
        const returnClass = pos.totalRealizedPL >= 0 ? 'text-red-600' : 'text-green-600';
        const returnRate = pos.totalCostBasis > 0 ? (pos.totalRealizedPL / pos.totalCostBasis) * 100 : 0;
        
        // 計算加權平均持有天期和總交易次數
        const totalMatchedQuantity = pos.closedLots.reduce((sum, lot) => sum + lot.transactions.find(t => t.type === 'sell').quantity, 0);
        const weightedAvgDays = pos.closedLots.reduce((sum, lot) => {
            const sellTx = lot.transactions.find(t => t.type === 'sell');
            const buyTxs = lot.transactions.filter(t => t.type === 'buy');
            const weightedDaysForLot = buyTxs.reduce((lotSum, buy) => {
                return lotSum + (calculateHoldingDays(buy.date.split('T')[0], sellTx.date.split('T')[0]) * buy.usedQty);
            }, 0);
            return sum + weightedDaysForLot;
        }, 0) / (totalMatchedQuantity || 1);
        
        const totalTransactions = new Set(pos.closedLots.flatMap(lot => lot.transactions.map(t => t.id))).size;


        return `
            <tbody class="bg-white">
                <tr class="closed-position-row cursor-pointer hover:bg-gray-50" data-symbol="${pos.symbol}">
                    <td class="px-2 py-4 whitespace-nowrap text-center">
                        <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}" class="w-5 h-5 text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}"></i>
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap">
                        <div class="font-bold text-base text-indigo-600">${pos.symbol}</div>
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap text-right">
                        <div class="font-semibold text-base ${returnClass}">${formatNumber(pos.totalRealizedPL, 0)}</div>
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap text-right">
                        <div class="font-semibold text-sm ${returnClass}">${formatNumber(returnRate, 2)}%</div>
                    </td>
                    <td class="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-700">${weightedAvgDays.toFixed(0)} 天</td>
                    <td class="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-700">${totalTransactions} 筆</td>
                </tr>
                ${isExpanded ? `
                <tr>
                    <td colspan="6" class="p-0 bg-white">
                        ${renderClosedPositionDetails(pos)}
                    </td>
                </tr>
                ` : ''}
            </tbody>
        `;
    }).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full border-separate" style="border-spacing: 0;">
                ${tableHeader}
                ${tableBody}
            </table>
        </div>
    `;

    lucide.createIcons();
}
