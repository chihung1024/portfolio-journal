// =========================================================================================
// == 持股表格 UI 模組 (holdings.ui.js) v3.2 - State-Driven UI & Rendering Fix
// =========================================================================================

import { getState, setState } from '../../state.js';
import { isTwStock, formatNumber } from '../utils.js';

/**
 * 輔助函式：渲染單一已平倉股票的所有詳細交易紀錄
 * @param {Array} lots - 屬於該股票的已平倉紀錄陣列
 * @returns {string} HTML string for the details table
 */
function renderClosedLotsDetails(lots) {
    if (!lots || lots.length === 0) return '<p class="px-4 py-2 text-xs text-gray-500">沒有找到詳細的平倉紀錄。</p>';

    const header = `
        <thead class="bg-gray-100">
            <tr>
                <th class="px-2 py-1 text-left text-xs font-medium text-gray-600">數量</th>
                <th class="px-2 py-1 text-left text-xs font-medium text-gray-600">買入日期</th>
                <th class="px-2 py-1 text-left text-xs font-medium text-gray-600">賣出日期</th>
                <th class="px-2 py-1 text-right text-xs font-medium text-gray-600">買入價 (TWD)</th>
                <th class="px-2 py-1 text-right text-xs font-medium text-gray-600">賣出價 (TWD)</th>
                <th class="px-2 py-1 text-right text-xs font-medium text-gray-600">單筆損益 (TWD)</th>
            </tr>
        </thead>`;
    
    const body = lots.map(lot => {
        const profitClass = lot.realizedPLTWD >= 0 ? 'text-red-500' : 'text-green-500';
        return `
            <tr>
                <td class="px-2 py-1 text-xs">${formatNumber(lot.quantity, isTwStock(lot.symbol) ? 0 : 4)}</td>
                <td class="px-2 py-1 text-xs">${lot.buyDate}</td>
                <td class="px-2 py-1 text-xs">${lot.sellDate}</td>
                <td class="px-2 py-1 text-xs text-right">${formatNumber(lot.buyPricePerShareTWD, 2)}</td>
                <td class="px-2 py-1 text-xs text-right">${formatNumber(lot.sellPricePerShareTWD, 2)}</td>
                <td class="px-2 py-1 text-xs text-right font-medium ${profitClass}">${formatNumber(lot.realizedPLTWD, 0)}</td>
            </tr>
        `;
    }).join('');

    return `<div class="p-2"><table class="min-w-full">${header}<tbody>${body}</tbody></table></div>`;
}


/**
 * 輔助函式：渲染整個「已平倉部位」區塊
 * @returns {string} HTML string for the closed positions section
 */
function renderClosedPositionsSection() {
    const { closedLots, isClosedPositionsExpanded, expandedClosedSymbol } = getState();
    if (!closedLots || closedLots.length === 0) {
        return '';
    }

    const closedPositionsBySymbol = closedLots.reduce((acc, lot) => {
        if (!acc[lot.symbol]) {
            acc[lot.symbol] = {
                symbol: lot.symbol,
                totalRealizedPLTWD: 0,
                lots: []
            };
        }
        acc[lot.symbol].totalRealizedPLTWD += lot.realizedPLTWD;
        acc[lot.symbol].lots.push(lot);
        return acc;
    }, {});

    const sortedClosedPositions = Object.values(closedPositionsBySymbol)
        .sort((a, b) => {
            const latestSellDateA = Math.max(...a.lots.map(l => new Date(l.sellDate).getTime()));
            const latestSellDateB = Math.max(...b.lots.map(l => new Date(l.sellDate).getTime()));
            return latestSellDateB - latestSellDateA;
        });
    
    const chevronClass = isClosedPositionsExpanded ? 'rotate-180' : '';
    const listClass = isClosedPositionsExpanded ? '' : 'hidden';

    const headerHtml = `
        <div id="closed-positions-toggle" class="mt-8 p-4 bg-gray-100 rounded-t-lg cursor-pointer hover:bg-gray-200 border-b border-gray-300">
            <h3 class="text-base font-semibold text-gray-800 flex items-center">
                <i data-lucide="archive" class="w-5 h-5 mr-2"></i>
                已平倉部位 (FIFO 明細)
                <i id="closed-positions-chevron" data-lucide="chevron-down" class="w-5 h-5 ml-auto transition-transform ${chevronClass}"></i>
            </h3>
        </div>
    `;

    const bodyHtml = sortedClosedPositions.map(pos => {
        const isExpanded = expandedClosedSymbol === pos.symbol;
        const profitClass = pos.totalRealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
        return `
            <div class="border-b">
                <div class="closed-position-item p-4 flex justify-between items-center cursor-pointer hover:bg-gray-50" data-symbol="${pos.symbol}">
                    <div>
                        <span class="font-bold text-base text-indigo-700">${pos.symbol}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-sm text-gray-500">總已實現損益</span>
                        <p class="font-semibold text-base ${profitClass}">${formatNumber(pos.totalRealizedPLTWD, 0)}</p>
                    </div>
                </div>
                <div class="closed-position-details-container bg-gray-50 ${isExpanded ? '' : 'hidden'}">
                    ${isExpanded ? renderClosedLotsDetails(pos.lots) : ''}
                </div>
            </div>
        `;
    }).join('');

    return `
        ${headerHtml}
        <div id="closed-positions-list" class="${listClass} bg-white rounded-b-lg border border-t-0 border-gray-200 overflow-hidden">
            ${bodyHtml}
        </div>
    `;
}

/**
 * 渲染單一持股的詳細卡片內容 (供列表模式展開使用)
 * @param {object} h - 單一持股物件
 * @returns {string} HTML string
 */
function renderHoldingDetailCardContent(h) {
    const decimals = isTwStock(h.symbol) ? 0 : 2;
    const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
    
    return `
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm p-4 bg-gray-50">
            <div><p class="text-gray-500">未實現損益</p><p class="font-medium ${returnClass}">${formatNumber(h.unrealizedPLTWD, 0)} (${(h.returnRate || 0).toFixed(2)}%)</p></div>
            <div><p class="text-gray-500">平均成本/放空價</p><p class="font-medium text-gray-800">${formatNumber(h.avgCostOriginal, 2)}</p></div>
            <div><p class="text-gray-500">現價 (${h.currency})</p><p class="font-medium text-gray-800"><span>${formatNumber(h.currentPriceOriginal, 2)}</span></p></div>
            <div><p class="text-gray-500">股數</p><p class="font-medium text-gray-800">${formatNumber(h.quantity, decimals)}</p></div>
            <div><p class="text-gray-500">持股佔比</p><p class="font-medium text-gray-800">${h.portfolioPercentage.toFixed(2)}%</p></div>
        </div>
    `;
}

/**
 * 主渲染函式，採用「狀態驅動」模式
 */
export function renderHoldingsTable(currentHoldings) {
    const { holdingsSort, mobileViewMode, activeMobileHolding, closedLots } = getState();
    const container = document.getElementById('holdings-content');
    container.innerHTML = ''; // 每次都清空容器
    
    let holdingsArray = Object.values(currentHoldings);
    
    let holdingsSectionHtml = '';

    if (holdingsArray.length > 0) {
        const viewSwitcherHtml = `
            <div id="holdings-view-switcher" class="mb-4 sm:hidden flex justify-end items-center space-x-2">
                <span class="text-sm font-medium text-gray-600">檢視模式:</span>
                <div class="flex items-center rounded-lg bg-gray-200 p-1">
                    <button data-view="card" class="btn p-2 rounded-md ${mobileViewMode === 'card' ? 'bg-white shadow' : ''}"><i data-lucide="layout-grid" class="w-5 h-5 ${mobileViewMode === 'card' ? 'text-indigo-600' : 'text-gray-500'}"></i></button>
                    <button data-view="list" class="btn p-2 rounded-md ${mobileViewMode === 'list' ? 'bg-white shadow' : ''}"><i data-lucide="list" class="w-5 h-5 ${mobileViewMode === 'list' ? 'text-indigo-600' : 'text-gray-500'}"></i></button>
                </div>
            </div>`;

        const totalMarketValue = holdingsArray.reduce((sum, h) => sum + h.marketValueTWD, 0);
        holdingsArray.forEach(h => {
            h.portfolioPercentage = totalMarketValue > 0 ? (h.marketValueTWD / totalMarketValue) * 100 : 0;
        });

        holdingsArray.sort((a, b) => {
            const valA = a[holdingsSort.key] || 0;
            const valB = b[holdingsSort.key] || 0;
            return holdingsSort.order === 'asc' ? valA - valB : valB - a[holdingsSort.key];
        });

        const getSortArrow = (key) => holdingsSort.key === key ? (holdingsSort.order === 'desc' ? '▼' : '▲') : '';
        const shortBadge = `<span class="ml-2 text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-sky-600 bg-sky-200">放空</span>`;

        const tableBodyHtml = holdingsArray.map(h => {
             const isShort = h.quantity < 0;
            const decimals = isTwStock(h.symbol) ? 0 : 2; 
            const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
            const dailyReturnClass = h.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';
            const priceClass = '';
            return `
                <tr class="hover:bg-gray-100 cursor-pointer holding-row" data-symbol="${h.symbol}" ${isShort ? 'style="background-color: #f0f9ff;"' : ''}>
                    <td class="px-6 py-4 whitespace-nowrap text-base font-medium text-gray-900"><div class="flex items-center"><span>${h.symbol}</span>${isShort ? shortBadge : ''}</div></td>
                    <td class="px-6 py-4 whitespace-nowrap text-base font-semibold text-right ${isShort ? 'text-sky-700' : ''}">${formatNumber(h.quantity, decimals)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-right"><div class="text-base font-semibold text-gray-900 ${priceClass} rounded px-1 inline-block">${formatNumber(h.currentPriceOriginal, 2)}</div><div class="text-sm text-gray-500">${formatNumber(h.avgCostOriginal, 2)} ${h.currency}</div></td>
                    <td class="px-6 py-4 whitespace-nowrap text-base text-right">${formatNumber(h.marketValueTWD, 0)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-right ${dailyReturnClass}"><div class="text-base font-semibold">${formatNumber(h.daily_pl_twd, 0)}</div><div class="text-sm">${(h.daily_change_percent || 0).toFixed(2)}%</div></td>
                    <td class="px-6 py-4 whitespace-nowrap text-right ${returnClass}"><div class="text-base font-semibold">${formatNumber(h.unrealizedPLTWD, 0)}</div><div class="text-sm">${(h.returnRate || 0).toFixed(2)}%</div></td>
                    <td class="px-6 py-4 whitespace-nowrap text-base text-right">${h.portfolioPercentage.toFixed(2)}%</td>
                </tr>`;
        }).join('');
        
        const tableHtml = `<div class="overflow-x-auto hidden sm:block"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-base text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider">股數</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider">現價 / 成本</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="marketValueTWD">市值(TWD) ${getSortArrow('marketValueTWD')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="daily_pl_twd">當日損益 ${getSortArrow('daily_pl_twd')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="unrealizedPLTWD">未實現損益 ${getSortArrow('unrealizedPLTWD')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="portfolioPercentage">持股佔比 ${getSortArrow('portfolioPercentage')}</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${tableBodyHtml}</tbody></table></div>`;

        const cardsHtml = `<div class="sm:hidden grid grid-cols-1 gap-4">${holdingsArray.map(h => { 
            const isShort = h.quantity < 0;
            const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
            return `<div class="bg-white rounded-lg shadow ${isShort ? 'ring-2 ring-sky-300' : ''}"><div class="p-4 space-y-3"><div class="flex justify-between items-center"><div class="flex items-center"><h3 class="font-bold text-lg text-indigo-600">${h.symbol}</h3>${isShort ? shortBadge : ''}</div><span class="font-semibold text-lg ${returnClass}">${(h.returnRate || 0).toFixed(2)}%</span></div>${renderHoldingDetailCardContent(h)}</div><div class="border-t border-gray-200 px-4 py-2"><button class="w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-800 open-details-btn" data-symbol="${h.symbol}">更多詳情</button></div></div>`; 
        }).join('')}</div>`;

        const listHtml = `<div class="sm:hidden space-y-2">${holdingsArray.map(h => {
            const isShort = h.quantity < 0;
            const dailyReturnClass = h.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';
            const isExpanded = activeMobileHolding === h.symbol;
            const detailsButtonHtml = `<div class="border-t border-gray-200 px-4 py-2"><button class="w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-800 open-details-btn" data-symbol="${h.symbol}">更多詳情</button></div>`;
            return `<div class="bg-white rounded-lg shadow overflow-hidden ${isShort ? 'ring-2 ring-sky-300' : ''}"><div class="px-2 py-3 flex justify-between items-center cursor-pointer list-view-item" data-symbol="${h.symbol}"><div class="flex items-center"><h3 class="font-bold text-base text-indigo-600">${h.symbol}</h3>${isShort ? shortBadge : ''}</div><div class="text-right"><p class="font-medium text-base text-gray-900">${formatNumber(h.currentPriceOriginal, 2)} <span class="text-sm text-gray-500">${h.currency}</span></p><p class="text-sm ${dailyReturnClass}">${formatNumber(h.daily_pl_twd, 0)} (${(h.daily_change_percent || 0).toFixed(2)}%)</p></div></div><div class="holding-details-container ${isExpanded ? '' : 'hidden'}">${isExpanded ? renderHoldingDetailCardContent(h) : ''}${isExpanded ? detailsButtonHtml : ''}</div></div>`;
        }).join('')}</div>`;
        
        const mobileContent = `<div class="${mobileViewMode === 'card' ? '' : 'hidden'}">${cardsHtml}</div><div class="${mobileViewMode === 'list' ? '' : 'hidden'}">${listHtml}</div>`;
        
        holdingsSectionHtml = viewSwitcherHtml + tableHtml + mobileContent;
    }
    
    const closedPositionsHtml = renderClosedPositionsSection();

    // 最終組合：將持股區塊和已平倉區塊組合
    container.innerHTML = holdingsSectionHtml + closedPositionsHtml;

    // 如果兩個區塊都為空，才顯示最終的提示訊息
    if (!holdingsSectionHtml && !closedPositionsHtml) {
         container.innerHTML = `<p class="text-center py-10 text-gray-500">沒有任何持股或交易紀錄。</p>`;
    }

    lucide.createIcons();

    // 重新綁定事件監聽器到新渲染的 DOM 元素上
    const toggleButton = document.getElementById('closed-positions-toggle');
    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            const currentState = getState();
            // 更新狀態，然後觸發重繪
            setState({ isClosedPositionsExpanded: !currentState.isClosedPositionsExpanded });
            renderHoldingsTable(currentHoldings);
        });
    }

    document.querySelectorAll('.closed-position-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const symbol = e.currentTarget.dataset.symbol;
            const currentState = getState();
            const newExpandedSymbol = currentState.expandedClosedSymbol === symbol ? null : symbol;
            
            // 更新狀態，並確保總列表是展開的
            setState({ 
                expandedClosedSymbol: newExpandedSymbol,
                isClosedPositionsExpanded: true 
            });
            renderHoldingsTable(currentHoldings); // 狀態改變，觸發重繪
        });
    });
}
