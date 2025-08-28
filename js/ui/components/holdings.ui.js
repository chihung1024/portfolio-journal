// =========================================================================================
// == 持股表格 UI 模組 (holdings.ui.js) - v2.1 (Note Feature Removed)
// =========================================================================================

import { getState, setState } from '../../state.js';
import { isTwStock, formatNumber } from '../utils.js';

/**
 * 渲染單一持股的詳細卡片內容 (供列表模式展開使用)
 * @param {object} h - 單一持股物件
 * @returns {string} HTML string
 */
function renderHoldingDetailCardContent(h) {
    const decimals = isTwStock(h.symbol) ? 0 : 2;
    const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
    
    // ========================= 【核心修改 - 開始】 =========================
    // 移除了所有與 stockNotes 和 priceClass 相關的邏輯
    return `
        <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm p-4 bg-gray-50">
            <div><p class="text-gray-500">未實現損益</p><p class="font-medium ${returnClass}">${formatNumber(h.unrealizedPLTWD, 0)} (${(h.returnRate || 0).toFixed(2)}%)</p></div>
            <div><p class="text-gray-500">平均成本/放空價</p><p class="font-medium text-gray-800">${formatNumber(h.avgCostOriginal, 2)}</p></div>
            <div><p class="text-gray-500">現價 (${h.currency})</p><p class="font-medium text-gray-800"><span>${formatNumber(h.currentPriceOriginal, 2)}</span></p></div>
            <div><p class="text-gray-500">股數</p><p class="font-medium text-gray-800">${formatNumber(h.quantity, decimals)}</p></div>
            <div><p class="text-gray-500">持股佔比</p><p class="font-medium text-gray-800">${h.portfolioPercentage.toFixed(2)}%</p></div>
        </div>
    `;
    // ========================= 【核心修改 - 結束】 =========================
}


export function renderHoldingsTable(currentHoldings) {
    // ========================= 【核心修改 - 開始】 =========================
    const { holdingsSort, mobileViewMode, activeMobileHolding } = getState();
    // ========================= 【核心修改 - 結束】 =========================
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

    const tableHtml = `<div class="overflow-x-auto hidden sm:block"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-base text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider">股數</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider">現價 / 成本</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="marketValueTWD">市值(TWD) ${getSortArrow('marketValueTWD')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="daily_pl_twd">當日損益 ${getSortArrow('daily_pl_twd')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="unrealizedPLTWD">未實現損益 ${getSortArrow('unrealizedPLTWD')}</th><th class="px-6 py-3 text-right text-base text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="portfolioPercentage">持股佔比 ${getSortArrow('portfolioPercentage')}</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${holdingsArray.map(h => { 
        const isShort = h.quantity < 0;
        const decimals = isTwStock(h.symbol) ? 0 : 2; 
        const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
        const dailyReturnClass = h.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';
        // ========================= 【核心修改 - 開始】 =========================
        const priceClass = ''; // 移除所有條件式樣式邏輯
        // ========================= 【核心修改 - 結束】 =========================
        return `
            <tr class="hover:bg-gray-100 cursor-pointer holding-row" data-symbol="${h.symbol}" ${isShort ? 'style="background-color: #f0f9ff;"' : ''}>
                <td class="px-6 py-4 whitespace-nowrap text-base font-medium text-gray-900">
                    <div class="flex items-center">
                        <span>${h.symbol}</span>
                        ${isShort ? shortBadge : ''}
                        </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-base font-semibold text-right ${isShort ? 'text-sky-700' : ''}">${formatNumber(h.quantity, decimals)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right">
                    <div class="text-base font-semibold text-gray-900 ${priceClass} rounded px-1 inline-block">${formatNumber(h.currentPriceOriginal, 2)}</div>
                    <div class="text-sm text-gray-500">${formatNumber(h.avgCostOriginal, 2)} ${h.currency}</div>
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
        const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
        return `
            <div class="bg-white rounded-lg shadow ${isShort ? 'ring-2 ring-sky-300' : ''}">
                <div class="p-4 space-y-3">
                    <div class="flex justify-between items-center">
                        <div class="flex items-center">
                            <h3 class="font-bold text-lg text-indigo-600">${h.symbol}</h3>
                            ${isShort ? shortBadge : ''}
                            </div>
                        <span class="font-semibold text-lg ${returnClass}">${(h.returnRate || 0).toFixed(2)}%</span>
                    </div>
                    ${renderHoldingDetailCardContent(h)}
                </div>
                <div class="border-t border-gray-200 px-4 py-2">
                    <button class="w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-800 open-details-btn" data-symbol="${h.symbol}">
                        更多詳情
                    </button>
                </div>
            </div>`; }).join('')}</div>`;

    const listHtml = `<div class="sm:hidden space-y-2">${holdingsArray.map(h => {
        const isShort = h.quantity < 0;
        const dailyReturnClass = h.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';
        const isExpanded = activeMobileHolding === h.symbol;
        
        const detailsButtonHtml = `
            <div class="border-t border-gray-200 px-4 py-2">
                <button class="w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-800 open-details-btn" data-symbol="${h.symbol}">
                    更多詳情
                </button>
            </div>
        `;

        return `
            <div class="bg-white rounded-lg shadow overflow-hidden ${isShort ? 'ring-2 ring-sky-300' : ''}">
                <div class="px-2 py-3 flex justify-between items-center cursor-pointer list-view-item" data-symbol="${h.symbol}">
                    <div class="flex items-center">
                        <h3 class="font-bold text-base text-indigo-600">${h.symbol}</h3>
                        ${isShort ? shortBadge : ''}
                        </div>
                    <div class="text-right">
                        <p class="font-medium text-base text-gray-900">${formatNumber(h.currentPriceOriginal, 2)} <span class="text-sm text-gray-500">${h.currency}</span></p>
                        <p class="text-sm ${dailyReturnClass}">${formatNumber(h.daily_pl_twd, 0)} (${(h.daily_change_percent || 0).toFixed(2)}%)</p>
                    </div>
                </div>
                <div class="holding-details-container ${isExpanded ? '' : 'hidden'}">
                    ${isExpanded ? renderHoldingDetailCardContent(h) : ''}
                    ${isExpanded ? detailsButtonHtml : ''}
                </div>
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
