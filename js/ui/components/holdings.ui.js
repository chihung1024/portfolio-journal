// =========================================================================================
// == 持股表格 UI 模組 (holdings.ui.js) - v3.0 (Visual & UX Enhancements)
// == 職責：處理持股一覽的桌面端表格、手機端卡片與列表模式的 UI 渲染。
// =========================================================================================

import { getState, setState } from '../../state.js';
import { isTwStock, formatNumber } from '../utils.js';

/**
 * 渲染單一持股的詳細卡片內容 (供列表模式展開或卡片模式使用)
 * @param {object} h - 單一持股物件
 * @returns {string} HTML string
 */
function renderHoldingDetailCardContent(h) {
    const decimals = isTwStock(h.symbol) ? 0 : 2;
    const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
    
    // 【優化】重新排版，使其在小螢幕上更清晰
    return `
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm p-4 bg-gray-50/70">
            <div>
                <p class="text-gray-500">未實現損益</p>
                <p class="font-semibold ${returnClass}">${formatNumber(h.unrealizedPLTWD, 0)}</p>
            </div>
            <div>
                <p class="text-gray-500">報酬率</p>
                <p class="font-semibold ${returnClass}">${(h.returnRate || 0).toFixed(2)}%</p>
            </div>
            <div>
                <p class="text-gray-500">平均成本 (${h.currency})</p>
                <p class="font-semibold text-gray-800">${formatNumber(h.avgCostOriginal, 2)}</p>
            </div>
             <div>
                <p class="text-gray-500">股數</p>
                <p class="font-semibold text-gray-800">${formatNumber(h.quantity, decimals)}</p>
            </div>
            <div>
                <p class="text-gray-500">市值 (TWD)</p>
                <p class="font-semibold text-gray-800">${formatNumber(h.marketValueTWD, 0)}</p>
            </div>
            <div>
                <p class="text-gray-500">持股佔比</p>
                <p class="font-semibold text-gray-800">${h.portfolioPercentage.toFixed(2)}%</p>
            </div>
        </div>
    `;
}


export function renderHoldingsTable(currentHoldings) {
    const { holdingsSort, mobileViewMode, activeMobileHolding } = getState();
    const container = document.getElementById('holdings-content');
    container.innerHTML = '';
    let holdingsArray = Object.values(currentHoldings);
    
    const viewSwitcherHtml = `
        <div id="holdings-view-switcher" class="mb-4 sm:hidden flex justify-end items-center space-x-2">
            <span class="text-sm font-medium text-gray-600">檢視模式:</span>
            <div class="flex items-center rounded-lg bg-gray-200 p-1">
                <button data-view="card" class="btn p-2 rounded-md ${mobileViewMode === 'card' ? 'bg-white shadow' : ''}">
                    <i data-lucide="layout-grid" class="w-5 h-5 ${mobileViewMode === 'card' ? 'text-indigo-600' : 'text-gray-500'}"></i>
                </button>
                <button data-view="list" class="btn p-2 rounded-md ${mobileViewMode === 'list' ? 'bg-white shadow' : ''}">
                    <i data-lucide="list" class="w-5 h-5 ${mobileViewMode === 'list' ? 'text-indigo-600' : 'text-gray-500'}"></i>
                </button>
            </div>
        </div>
    `;

    if (holdingsArray.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">沒有持股紀錄，請新增一筆交易。</p>`;
        return;
    }

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

    const tableHtml = `<div class="overflow-x-auto hidden sm:block"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-base text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider">股數</th><th class="px-6 py-3 text-center text-base text-gray-500 uppercase tracking-wider">現價 / 成本</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="marketValueTWD">市值(TWD) ${getSortArrow('marketValueTWD')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="daily_pl_twd">當日損益 ${getSortArrow('daily_pl_twd')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="unrealizedPLTWD">未實現損益 ${getSortArrow('unrealizedPLTWD')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="portfolioPercentage">持股佔比 ${getSortArrow('portfolioPercentage')}</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${holdingsArray.map(h => { 
        const isShort = h.quantity < 0;
        const decimals = isTwStock(h.symbol) ? 0 : 2; 
        const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
        const dailyReturnClass = h.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';
        
        // 【新增】成本線視覺化邏輯
        const priceDiff = h.currentPriceOriginal - h.avgCostOriginal;
        const isPriceUp = priceDiff > 0;
        // 為了視覺化，我們將差異程度標準化為一個百分比 (最大不超過 50%)
        // 這會讓價格離成本越遠，線條上的位移越明顯，但有一個上限
        const priceOffset = Math.min(Math.abs(priceDiff / (h.avgCostOriginal || 1)) * 50, 50);
        const pricePositionClass = isPriceUp ? 'price-above-cost' : 'price-below-cost';
        const pricePositionStyle = `--price-offset: ${isPriceUp ? -priceOffset : priceOffset}%;`;

        return `
            <tr class="hover:bg-gray-100 cursor-pointer holding-row" data-symbol="${h.symbol}" ${isShort ? 'style="background-color: #f0f9ff;"' : ''}>
                <td class="px-6 py-4 whitespace-nowrap text-base font-medium text-gray-900">
                    <div class="flex items-center">
                        <span>${h.symbol}</span>
                        ${isShort ? shortBadge : ''}
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-base font-semibold text-right ${isShort ? 'text-sky-700' : ''}">${formatNumber(h.quantity, decimals)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-center">
                    <div class="cost-basis-container">
                        <div class="${pricePositionClass}" style="${pricePositionStyle}">
                            <span class="price-value font-semibold ${isPriceUp ? 'text-red-600' : 'text-green-600'}">${formatNumber(h.currentPriceOriginal, 2)}</span>
                        </div>
                        <div class="cost-value text-xs text-gray-500">${formatNumber(h.avgCostOriginal, 2)}</div>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-base text-right">${formatNumber(h.marketValueTWD, 0)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right ${dailyReturnClass}">
                    <div class="text-base font-semibold">${formatNumber(h.daily_pl_twd, 0)}</div>
                    <div class="text-sm">${(h.daily_change_percent || 0).toFixed(2)}%</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right ${returnClass}">
                    <div class="text-base font-semibold">${formatNumber(h.unrealizedPLTWD, 0)}</div>
                    <div class="text-sm">${(h.returnRate || 0).toFixed(2)}%</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-base text-right">${h.portfolioPercentage.toFixed(2)}%</td>
            </tr>`; }).join('')}</tbody></table></div>`;

    const cardsHtml = `<div class="sm:hidden grid grid-cols-1 gap-4">${holdingsArray.map(h => { 
        const isShort = h.quantity < 0;
        return `
            <div class="bg-white rounded-lg shadow overflow-hidden ${isShort ? 'ring-2 ring-sky-300' : ''}">
                <div class="p-4 flex justify-between items-start">
                    <div>
                        <div class="flex items-center">
                            <h3 class="font-bold text-lg text-indigo-600">${h.symbol}</h3>
                            ${isShort ? shortBadge : ''}
                        </div>
                        <p class="text-xs text-gray-500">${h.currency}</p>
                    </div>
                    <p class="font-semibold text-lg ${h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600'}">${(h.returnRate || 0).toFixed(2)}%</p>
                </div>
                ${renderHoldingDetailCardContent(h)}
                <div class="border-t border-gray-200 px-4 py-2 bg-gray-50">
                    <button class="w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-800 open-details-btn" data-symbol="${h.symbol}">
                        查看完整交易紀錄
                    </button>
                </div>
            </div>`; }).join('')}</div>`;

    const listHtml = `<div class="sm:hidden space-y-2">${holdingsArray.map(h => {
        const isShort = h.quantity < 0;
        const dailyReturnClass = h.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';
        const isExpanded = activeMobileHolding === h.symbol;
        
        const detailsButtonHtml = `
            <div class="border-t border-gray-200 px-4 py-2 bg-gray-50">
                <button class="w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-800 open-details-btn" data-symbol="${h.symbol}">
                    ${isExpanded ? '查看完整交易紀錄' : '...'}
                </button>
            </div>
        `;

        return `
            <div class="bg-white rounded-lg shadow overflow-hidden ${isShort ? 'ring-2 ring-sky-300' : ''}">
                <div class="px-3 py-3 flex justify-between items-center cursor-pointer list-view-item" data-symbol="${h.symbol}">
                    <div class="flex items-center">
                         <i data-lucide="chevron-down" class="w-5 h-5 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''} mr-2"></i>
                        <h3 class="font-bold text-base text-indigo-600">${h.symbol}</h3>
                        ${isShort ? shortBadge : ''}
                    </div>
                    <div class="text-right">
                        <p class="font-medium text-base text-gray-900">${formatNumber(h.currentPriceOriginal, 2)} <span class="text-sm text-gray-500">${h.currency}</span></p>
                        <p class="text-sm ${dailyReturnClass}">${formatNumber(h.daily_pl_twd, 0)} (${(h.daily_change_percent || 0).toFixed(2)}%)</p>
                    </div>
                </div>
                <div class="holding-details-container ${isExpanded ? 'expanded' : ''}">
                    ${isExpanded ? renderHoldingDetailCardContent(h) : ''}
                </div>
                ${detailsButtonHtml}
            </div>
        `;
    }).join('')}</div>`;

    const mobileContent = `
        <div class="${mobileViewMode === 'card' ? '' : 'hidden'}">${cardsHtml}</div>
        <div class="${mobileViewMode === 'list' ? '' : 'hidden'}">${listHtml}</div>
    `;

    container.innerHTML = viewSwitcherHtml + tableHtml + mobileContent;
    lucide.createIcons();
}
