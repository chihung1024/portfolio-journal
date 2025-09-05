
// =========================================================================================
// == 平倉紀錄 UI 模組 (closedPositions.ui.js) - v2.8 (Final Font Hierarchy Fix)
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
 * 渲染單筆平倉紀錄的詳細交易明細 (故事線視圖)，修正了數據篩選邏輯
 */
function renderSaleLotDetails(lot, symbol) {
    const buysHtml = lot.transactions
        .filter(tx => tx.type === 'buy')
        .map(buy => `
            <div class="grid grid-cols-3 gap-4 text-sm items-center py-2.5 px-4">
                <div class="text-gray-700">${buy.date.split('T')[0]}</div>
                <div class="text-right font-mono text-gray-800">${formatNumber(buy.usedQty, isTwStock(symbol) ? 0 : 4)}</div>
                <div class="text-right font-mono text-gray-800">${formatNumber(buy.price, 2)}</div>
            </div>
        `).join('<hr class="border-gray-100">');

    return `
        <div class="border border-gray-200 bg-white rounded-lg overflow-hidden">
            <div class="grid grid-cols-3 gap-4 text-sm font-semibold text-gray-500 bg-gray-50 py-2 px-4 border-b border-gray-200">
                <div>買入日期</div>
                <div class="text-right">配對股數</div>
                <div class="text-right">成本價</div>
            </div>
            <div>${buysHtml}</div>
        </div>`;
}

/**
 * 渲染整個展開後的詳細內容區域，包含多個可獨立摺疊的平倉批次
 */
function renderClosedPositionDetails(position, expandedSales) {
    if (!position.closedLots || position.closedLots.length === 0) {
        return '<div class="px-4 sm:px-6 py-5 bg-gray-50/70 border-t"><p class="text-center text-sm text-gray-500">沒有詳細的平倉批次紀錄。</p></div>';
    }

    const sellBlocksHtml = position.closedLots.map(lot => {
        const sellTx = lot.transactions.find(t => t.type === 'sell');
        if (!sellTx) return '';

        const saleId = `${position.symbol}|${sellTx.id}`; // 使用唯一的交易ID作為摺疊key
        const isSaleExpanded = expandedSales.has(saleId);
        const returnRate = lot.costBasis > 0 ? (lot.realizedPL / lot.costBasis) * 100 : 0;
        const returnClass = lot.realizedPL >= 0 ? 'text-red-500' : 'text-green-500';

        return `
            <div class="mb-4 last:mb-0">
                <div class="closed-position-sale-header flex justify-between items-center p-3 rounded-lg hover:bg-gray-100 cursor-pointer" data-sale-id="${saleId}">
                    <div class="flex items-center space-x-3">
                        <i data-lucide="chevron-down" class="w-5 h-5 text-gray-400 transition-transform duration-300 ${isSaleExpanded ? 'rotate-180' : ''}"></i>
                        <div>
                            <p class="font-semibold text-base text-gray-800">${sellTx.date.split('T')[0]}</p>
                            <p class="text-sm text-gray-500">賣 @ ${formatNumber(sellTx.price, 2)}・${formatNumber(sellTx.quantity, isTwStock(position.symbol) ? 0 : 2)} 股</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="font-bold text-xl ${returnClass}">${formatNumber(lot.realizedPL, 0)}</p>
                        <p class="font-semibold text-base ${returnClass}">(${formatNumber(returnRate, 2)}%)</p>
                    </div>
                </div>
                ${isSaleExpanded ? `
                <div class="pt-2 pb-1 pl-6">
                    ${renderSaleLotDetails(lot, position.symbol)}
                </div>
                ` : ''}
            </div>
        `;
    }).join('');

    return `<div class="px-2 sm:px-4 py-4 bg-gray-50/70 border-t border-gray-200">${sellBlocksHtml}</div>`;
}


/**
 * 渲染整個平倉紀錄的主列表
 */
export function renderClosedPositionsTable() {
    const { closedPositions, activeClosedPosition } = getState();
    const container = document.getElementById('closed-positions-tab');
    if (!container) return;

    if (!closedPositions || closedPositions.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">沒有已平倉的股票紀錄。</p>`;
        return;
    }

    const mainContent = closedPositions.map(pos => {
        const isSymbolExpanded = activeClosedPosition && activeClosedPosition.symbol === pos.symbol;
        const returnClass = pos.totalRealizedPL >= 0 ? 'text-red-500' : 'text-green-500';
        const returnRate = pos.totalCostBasis > 0 ? (pos.totalRealizedPL / pos.totalCostBasis) * 100 : 0;
        
        return `
            <div class="bg-white rounded-lg shadow-md overflow-hidden mb-3">
                <div class="closed-position-row p-4 cursor-pointer" data-symbol="${pos.symbol}">
                    <div class="flex justify-between items-center">
                        <div class="flex items-center space-x-3">
                           <i data-lucide="chevron-down" class="w-5 h-5 text-gray-400 transition-transform duration-300 ${isSymbolExpanded ? 'rotate-180' : ''}"></i>
                           <h3 class="font-bold text-xl text-indigo-700">${pos.symbol}</h3>
                        </div>
                        <div class="text-right">
                            <p class="font-semibold text-2xl ${returnClass}">${formatNumber(pos.totalRealizedPL, 0)}</p>
                            <p class="font-medium text-base ${returnClass}">${formatNumber(returnRate, 2)}%</p>
                        </div>
                    </div>
                </div>
                ${isSymbolExpanded ? renderClosedPositionDetails(pos, activeClosedPosition.expandedSales) : ''}
            </div>`;
    }).join('');

    container.innerHTML = `<div class="space-y-4 p-2">${mainContent}</div>`;
    lucide.createIcons();
}
