// =========================================================================================
// == 平倉紀錄 UI 模組 (closedPositions.ui.js) - v2.6 (Ultimate Simplification)
// == 職責：渲染平倉紀錄頁籤的內容，聚焦核心績效指標。
// =========================================================================================

import { getState } from '../../state.js';
import { formatNumber, isTwStock } from '../utils.js';

/**
 * 渲染單筆平倉紀錄的詳細交易明細 (僅顯示買入批次)
 */
function renderClosedPositionDetails(position) {
    // 雖然外部不再顯示持有天期，但此處仍需計算以供內部使用
    const calculateHoldingDays = (dateStr1, dateStr2) => {
        const date1 = new Date(dateStr1);
        const date2 = new Date(dateStr2);
        return Math.round((date2 - date1) / (1000 * 3600 * 24));
    };

    const lotsBySellDate = position.closedLots.reduce((acc, lot) => {
        const sellTx = lot.transactions.find(t => t.type === 'sell');
        if (!sellTx) return acc;
        const sellDate = sellTx.date.split('T')[0];
        if (!acc[sellDate]) {
            acc[sellDate] = { matchedBuys: [] };
        }
        acc[sellDate].matchedBuys.push(...lot.transactions.filter(t => t.type === 'buy'));
        return acc;
    }, {});

    const sellBlocksHtml = Object.values(lotsBySellDate).map(data => {
        const buysHtml = data.matchedBuys.map(buy => `
            <div class="grid grid-cols-3 sm:grid-cols-4 gap-4 text-sm items-center py-2.5 px-4">
                <div class="text-gray-700">${buy.date.split('T')[0]}</div>
                <div class="text-right font-mono text-gray-800">${formatNumber(buy.usedQty, isTwStock(buy.symbol) ? 0 : 4)}</div>
                <div class="text-right font-mono text-gray-800">${formatNumber(buy.price, 2)}</div>
                <div class="hidden sm:block text-right text-gray-700">${calculateHoldingDays(buy.date.split('T')[0], data.matchedBuys[0].date.split('T')[0])} 天</div>
            </div>
        `).join('<hr class="border-gray-100">');

        return `
            <div class="border border-gray-200 rounded-lg overflow-hidden">
                <div class="grid grid-cols-3 sm:grid-cols-4 gap-4 text-sm font-semibold text-gray-500 bg-gray-50 py-2 px-4 border-b border-gray-200">
                    <div>買入日期</div>
                    <div class="text-right">配對股數</div>
                    <div class="text-right">成本價</div>
                    <div class="hidden sm:block text-right">持有天期</div>
                </div>
                <div>${buysHtml}</div>
            </div>`;
    }).join('');

    return `<div class="px-4 sm:px-6 py-4 bg-gray-50/70 border-t border-gray-200">${sellBlocksHtml}</div>`;
}


/**
 * 渲染整個平倉紀錄的主列表
 */
export function renderClosedPositionsTable() {
    const { closedPositions, activeClosedPosition } = getState();
    const container = document.getElementById('closed-positions-tab');
    if (!container) return;

    if (!closedPositions || closedPositions.length === 0) {
        container.innerHTML `<p class="text-center py-10 text-gray-500">沒有已平倉的股票紀錄。</p>`;
        return;
    }

    // 預先處理所有平倉數據，將其按股票和賣出日期分組
    const processedData = closedPositions.map(pos => {
        const sales = pos.closedLots.reduce((acc, lot) => {
            const sellTx = lot.transactions.find(t => t.type === 'sell');
            if (!sellTx) return acc;
            const sellDate = sellTx.date.split('T')[0];
            if (!acc[sellDate]) {
                acc[sellDate] = { sellTransaction: sellTx, totalCostBasis: 0, totalProceeds: 0, totalQuantity: 0 };
            }
            acc[sellDate].totalCostBasis += lot.costBasis;
            acc[sellDate].totalProceeds += lot.proceeds;
            acc[sellDate].totalQuantity += sellTx.quantity;
            return acc;
        }, {});
        return { ...pos, sales };
    });

    const renderContent = (isMobile) => {
        return processedData.map(pos => {
            const isSymbolExpanded = activeClosedPosition && activeClosedPosition.symbol === pos.symbol;
            const returnClass = pos.totalRealizedPL >= 0 ? 'text-red-500' : 'text-green-600';
            const returnRate = pos.totalCostBasis > 0 ? (pos.totalRealizedPL / pos.totalCostBasis) * 100 : 0;

            const salesHtml = Object.entries(pos.sales).map(([sellDate, saleData]) => {
                const realizedPL = saleData.totalProceeds - saleData.totalCostBasis;
                const rate = saleData.totalCostBasis > 0 ? (realizedPL / saleData.totalCostBasis) * 100 : 0;
                const plColor = realizedPL >= 0 ? 'text-red-500' : 'text-green-600';
                const saleId = `${pos.symbol}|${sellDate}`;
                const isSaleExpanded = isSymbolExpanded && activeClosedPosition.expandedSales.has(saleId);
                
                return `
                    <div class="bg-white border-b border-gray-200 last:border-b-0">
                        <div class="closed-position-sale-header cursor-pointer hover:bg-gray-50 p-4" data-sale-id="${saleId}">
                            <div class="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 items-center">
                                <div class="sm:col-span-2 flex items-center space-x-3">
                                    <i data-lucide="chevron-down" class="w-5 h-5 text-gray-400 transition-transform duration-300 ${isSaleExpanded ? 'rotate-180' : ''}"></i>
                                    <div>
                                        <p class="font-semibold text-gray-800">${sellDate}</p>
                                        <p class="text-xs text-gray-500">賣 @ ${formatNumber(saleData.sellTransaction.price, 2)}</p>
                                    </div>
                                </div>
                                <div class="text-left sm:text-right">
                                    <p class="text-sm font-medium text-gray-800">${formatNumber(saleData.totalQuantity, isTwStock(pos.symbol) ? 0 : 2)} 股</p>
                                </div>
                                <div class="text-left sm:text-right">
                                    <p class="font-semibold text-base ${plColor}">${formatNumber(realizedPL, 0)}</p>
                                </div>
                                <div class="text-left sm:text-right">
                                    <p class="font-semibold text-base ${plColor}">(${formatNumber(rate, 2)}%)</p>
                                </div>
                            </div>
                        </div>
                        ${isSaleExpanded ? renderClosedPositionDetails(pos) : ''}
                    </div>
                `;
            }).join('');

            return `
                <div class="bg-white rounded-lg shadow-md overflow-hidden mb-4">
                    <div class="closed-position-row cursor-pointer p-4 bg-gray-50 border-b border-gray-200" data-symbol="${pos.symbol}">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center space-x-3">
                                <i data-lucide="chevron-down" class="w-5 h-5 text-gray-500 transition-transform duration-300 ${isSymbolExpanded ? 'rotate-180' : ''}"></i>
                                <h3 class="font-bold text-xl text-indigo-700">${pos.symbol}</h3>
                            </div>
                            <div class="text-right">
                                <p class="font-semibold text-xl ${returnClass}">${formatNumber(pos.totalRealizedPL, 0)}</p>
                                <p class="text-sm font-medium ${returnClass}">${formatNumber(returnRate, 2)}%</p>
                            </div>
                        </div>
                    </div>
                    ${isSymbolExpanded ? `<div class="bg-white">${salesHtml}</div>` : ''}
                </div>
            `;
        }).join('');
    };

    container.innerHTML = `<div>${renderContent()}</div>`;
    lucide.createIcons();
}
