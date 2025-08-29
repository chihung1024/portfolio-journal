// =========================================================================================
// == 平倉紀錄 UI 模組 (closedPositions.ui.js) - v2.5 (Mobile-First Responsive Overhaul)
// == 職責：渲染平倉紀錄頁籤的內容，包括可展開的交易明細。
// =========================================================================================

import { getState } from '../../state.js';
import { formatNumber, isTwStock } from '../utils.js';

/**
 * 輔助函式：計算兩個日期之間的天數差異
 */
function calculateHoldingDays(dateStr1, dateStr2) {
    const date1 = new Date(dateStr1);
    const date2 = new Date(dateStr2);
    const differenceInTime = date2.getTime() - date1.getTime();
    return Math.round(differenceInTime / (1000 * 3600 * 24));
}

/**
 * 渲染單筆平倉紀錄的詳細交易明細 (故事線視圖)，支援巢狀摺疊
 */
function renderClosedPositionDetails(position, expandedSales) {
    if (!position.closedLots || position.closedLots.length === 0) {
        return '<div class="px-4 sm:px-6 py-5 bg-gray-50 border-t"><p class="text-center text-sm text-gray-500">沒有詳細的平倉批次紀錄。</p></div>';
    }

    const lotsBySellDate = position.closedLots.reduce((acc, lot) => {
        const sellTx = lot.transactions.find(t => t.type === 'sell');
        if (!sellTx) return acc;
        const sellDate = sellTx.date.split('T')[0];
        if (!acc[sellDate]) {
            acc[sellDate] = { sellTransaction: sellTx, matchedBuys: [], totalCostBasis: 0, totalProceeds: 0 };
        }
        acc[sellDate].matchedBuys.push(...lot.transactions.filter(t => t.type === 'buy'));
        acc[sellDate].totalCostBasis += lot.costBasis;
        acc[sellDate].totalProceeds += lot.proceeds;
        return acc;
    }, {});

    const sellBlocksHtml = Object.entries(lotsBySellDate).map(([sellDate, data]) => {
        const { sellTransaction, matchedBuys, totalCostBasis, totalProceeds } = data;
        const realizedPL = totalProceeds - totalCostBasis;
        const returnRate = totalCostBasis > 0 ? (realizedPL / totalCostBasis) * 100 : 0;
        const returnClass = realizedPL >= 0 ? 'text-red-500' : 'text-green-500';
        const avgHoldingDays = matchedBuys.reduce((sum, buy) => sum + (calculateHoldingDays(buy.date.split('T')[0], sellDate) * buy.usedQty), 0) / (matchedBuys.reduce((sum, buy) => sum + buy.usedQty, 0) || 1);
        
        const saleId = `${position.symbol}|${sellDate}`;
        const isSaleExpanded = expandedSales.has(saleId);

        const buysHtml = matchedBuys.map(buy => `
            <div class="grid grid-cols-4 gap-4 text-sm items-center py-2.5 px-4">
                <div class="text-gray-700">${buy.date.split('T')[0]}</div>
                <div class="text-right font-mono text-gray-800">${formatNumber(buy.usedQty, isTwStock(buy.symbol) ? 0 : 4)}</div>
                <div class="text-right font-mono text-gray-800">${formatNumber(buy.price, 2)}</div>
                <div class="text-right text-gray-700">${calculateHoldingDays(buy.date.split('T')[0], sellDate)} 天</div>
            </div>
        `).join('<hr class="border-gray-100">');

        return `
            <div class="mb-6 last:mb-0">
                <div class="closed-position-sale-header flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 cursor-pointer group" data-sale-id="${saleId}">
                     <div class="flex items-center space-x-3">
                        <i data-lucide="chevron-down" class="w-5 h-5 text-gray-400 transition-transform duration-300 group-hover:text-gray-600 ${isSaleExpanded ? 'rotate-180' : ''}"></i>
                        <span class="text-sm font-semibold text-green-800 bg-green-100 px-3 py-1 rounded-md">平倉</span>
                        <span class="text-base font-semibold text-gray-800">${sellDate}</span>
                    </div>
                    <p class="text-sm text-gray-600 mt-2 sm:mt-0 sm:ml-auto pl-8 sm:pl-0">
                        賣出 ${formatNumber(sellTransaction.quantity, isTwStock(sellTransaction.symbol) ? 0 : 2)} 股 @ ${formatNumber(sellTransaction.price, 2)}
                    </p>
                </div>

                ${isSaleExpanded ? `
                <div class="pl-8 sm:pl-0">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 border border-gray-200 bg-white rounded-lg p-4">
                        <div><p class="text-sm text-gray-500">成本</p><p class="font-semibold text-lg text-gray-800">${formatNumber(totalCostBasis, 0)}</p></div>
                        <div><p class="text-sm text-gray-500">收入</p><p class="font-semibold text-lg text-gray-800">${formatNumber(totalProceeds, 0)}</p></div>
                        <div><p class="text-sm text-gray-500">持有天期</p><p class="font-semibold text-lg text-gray-800">${avgHoldingDays.toFixed(0)} 天</p></div>
                        <div class="text-left md:text-right">
                            <p class="text-sm text-gray-500">損益 (TWD)</p>
                            <div class="flex items-baseline justify-start md:justify-end">
                                <p class="font-bold text-2xl ${returnClass}">${formatNumber(realizedPL, 0)}</p>
                                <p class="font-semibold text-base ml-2 ${returnClass}">(${formatNumber(returnRate, 2)}%)</p>
                            </div>
                        </div>
                    </div>
                    <div class="mt-4 border border-gray-200 rounded-lg overflow-hidden">
                        <div class="grid grid-cols-4 gap-4 text-sm font-semibold text-gray-500 bg-gray-50 py-2 px-4 border-b border-gray-200">
                            <div>買入日期</div><div class="text-right">配對股數</div><div class="text-right">成本價</div><div class="text-right">持有天期</div>
                        </div>
                        <div>${buysHtml}</div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    }).join('');

    return `<div class="px-4 sm:px-6 py-5 bg-gray-50/70 border-t border-gray-200">${sellBlocksHtml}</div>`;
}

/**
 * 渲染整個平倉紀錄的主列表 (桌面版使用 Table)
 */
function renderDesktopTable(closedPositions, activeClosedPosition) {
    const tableHeader = `<thead class="bg-gray-50"><tr><th class="w-12 px-3 py-3 text-left text-xs font-medium text-gray-500"></th><th class="px-4 py-3 text-left text-sm font-medium text-gray-600 tracking-wider">代碼</th><th class="px-4 py-3 text-right text-sm font-medium text-gray-600 tracking-wider">總已實現損益 (TWD)</th><th class="px-4 py-3 text-right text-sm font-medium text-gray-600 tracking-wider">報酬率</th></tr></thead>`;
    
    const tableBody = closedPositions.map(pos => {
        const isSymbolExpanded = activeClosedPosition && activeClosedPosition.symbol === pos.symbol;
        const returnClass = pos.totalRealizedPL >= 0 ? 'text-red-500' : 'text-green-600';
        const returnRate = pos.totalCostBasis > 0 ? (pos.totalRealizedPL / pos.totalCostBasis) * 100 : 0;
        const rowClass = isSymbolExpanded ? 'bg-gray-50 hover:bg-gray-100' : 'hover:bg-gray-50';

        return `
            <tbody class="border-b border-gray-200 last:border-b-0">
                <tr class="closed-position-row cursor-pointer ${rowClass}" data-symbol="${pos.symbol}">
                    <td class="px-3 py-4 whitespace-nowrap text-center"><i data-lucide="chevron-down" class="w-5 h-5 text-gray-400 transition-transform duration-300 ${isSymbolExpanded ? 'rotate-180' : ''}"></i></td>
                    <td class="px-4 py-4 whitespace-nowrap"><div class="font-bold text-base text-indigo-700">${pos.symbol}</div></td>
                    <td class="px-4 py-4 whitespace-nowrap text-right"><div class="font-semibold text-xl ${returnClass}">${formatNumber(pos.totalRealizedPL, 0)}</div></td>
                    <td class="px-4 py-4 whitespace-nowrap text-right"><div class="font-semibold text-xl ${returnClass}">${formatNumber(returnRate, 2)}%</div></td>
                </tr>
                ${isSymbolExpanded ? `<tr><td colspan="4" class="p-0 bg-white">${renderClosedPositionDetails(pos, activeClosedPosition.expandedSales)}</td></tr>` : ''}
            </tbody>`;
    }).join('');

    return `<table class="min-w-full">
                ${tableHeader}
                ${tableBody}
            </table>`;
}

/**
 * 渲染整個平倉紀錄的主列表 (行動裝置版使用 Card)
 */
function renderMobileCards(closedPositions, activeClosedPosition) {
    return closedPositions.map(pos => {
        const isSymbolExpanded = activeClosedPosition && activeClosedPosition.symbol === pos.symbol;
        const returnClass = pos.totalRealizedPL >= 0 ? 'text-red-500' : 'text-green-500';
        const returnRate = pos.totalCostBasis > 0 ? (pos.totalRealizedPL / pos.totalCostBasis) * 100 : 0;
        return `
            <div class="bg-white rounded-lg shadow-md overflow-hidden">
                <div class="closed-position-row p-4 cursor-pointer" data-symbol="${pos.symbol}">
                    <div class="flex justify-between items-start">
                        <div class="flex items-center space-x-3">
                           <i data-lucide="chevron-down" class="w-5 h-5 text-gray-400 transition-transform duration-300 ${isSymbolExpanded ? 'rotate-180' : ''}"></i>
                           <h3 class="font-bold text-xl text-indigo-700">${pos.symbol}</h3>
                        </div>
                        <div class="text-right">
                            <p class="font-semibold text-xl ${returnClass}">${formatNumber(pos.totalRealizedPL, 0)}</p>
                            <p class="text-sm font-medium ${returnClass}">${formatNumber(returnRate, 2)}%</p>
                        </div>
                    </div>
                </div>
                ${isSymbolExpanded ? renderClosedPositionDetails(pos, activeClosedPosition.expandedSales) : ''}
            </div>`;
    }).join('');
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

    container.innerHTML = `
        <div class="overflow-x-auto">
            <div class="hidden sm:block">
                ${renderDesktopTable(closedPositions, activeClosedPosition)}
            </div>
            <div class="sm:hidden space-y-4 p-2">
                ${renderMobileCards(closedPositions, activeClosedPosition)}
            </div>
        </div>`;

    lucide.createIcons();
}
