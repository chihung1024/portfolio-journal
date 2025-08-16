// =========================================================================================
// == 持股表格 UI 模組 (holdings.ui.js) - v_final (支援放空)
// =========================================================================================

import { getState } from '../../state.js';
import { isTwStock, formatNumber } from '../utils.js';

export function renderHoldingsTable(currentHoldings) {
    const { stockNotes, holdingsSort } = getState();
    const container = document.getElementById('holdings-content');
    container.innerHTML = '';
    let holdingsArray = Object.values(currentHoldings);
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
        return holdingsSort.order === 'asc' ? valA - valB : valB - valA;
    });
    const getSortArrow = (key) => holdingsSort.key === key ? (holdingsSort.order === 'desc' ? '▼' : '▲') : '';
    
    const shortBadge = `<span class="ml-2 text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-sky-600 bg-sky-200">放空</span>`;

    const tableHtml = `<div class="overflow-x-auto hidden sm:block"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">股數</th><th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">現價 / 成本</th><th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="marketValueTWD">市值(TWD) ${getSortArrow('marketValueTWD')}</th><th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="daily_pl_twd">當日損益 ${getSortArrow('daily_pl_twd')}</th><th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="unrealizedPLTWD">未實現損益 ${getSortArrow('unrealizedPLTWD')}</th><th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="portfolioPercentage">持股佔比 ${getSortArrow('portfolioPercentage')}</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${holdingsArray.map(h => { 
        const isShort = h.quantity < 0;
        const note = stockNotes[h.symbol] || {}; 
        const decimals = isTwStock(h.symbol) ? 0 : 2; 
        const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
        const dailyReturnClass = h.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';
        let priceClass = ''; 
        if (isShort) {
             if (note.target_price && h.currentPriceOriginal <= note.target_price) priceClass = 'bg-green-100 text-green-800'; 
             else if (note.stop_loss_price && h.currentPriceOriginal >= note.stop_loss_price) priceClass = 'bg-red-100 text-red-800';
        } else {
             if (note.target_price && h.currentPriceOriginal >= note.target_price) priceClass = 'bg-green-100 text-green-800'; 
             else if (note.stop_loss_price && h.currentPriceOriginal <= note.stop_loss_price) priceClass = 'bg-red-100 text-red-800';
        }
        return `
            <tr class="hover:bg-gray-50 ${isShort ? 'bg-sky-50' : ''}">
                <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 flex items-center">
                    ${h.symbol} ${isShort ? shortBadge : ''}
                    <button class="ml-2 open-notes-btn" data-symbol="${h.symbol}"><i data-lucide="notebook-pen" class="w-4 h-4 text-gray-400 hover:text-indigo-600"></i></button>
                </td>
                <td class="px-6 py-4 whitespace-nowrap font-semibold text-right ${isShort ? 'text-sky-700' : ''}">${formatNumber(h.quantity, decimals)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right">
                    <div class="text-sm font-semibold text-gray-900 ${priceClass} rounded px-1 inline-block">${formatNumber(h.currentPriceOriginal, 2)}</div>
                    <div class="text-xs text-gray-500">${formatNumber(h.avgCostOriginal, 2)} ${h.currency}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right">${formatNumber(h.marketValueTWD, 0)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-right ${dailyReturnClass}">
                    <div class="text-sm font-semibold">${formatNumber(h.daily_pl_twd, 0)}</div>
                    <div class="text-xs">${(h.daily_change_percent || 0).toFixed(2)}%</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right ${returnClass}">
                    <div class="text-sm font-semibold">${formatNumber(h.unrealizedPLTWD, 0)}</div>
                    <div class="text-xs">${(h.returnRate || 0).toFixed(2)}%</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right">${h.portfolioPercentage.toFixed(2)}%</td>
            </tr>`; }).join('')}</tbody></table></div>`;
    
    // 手機版視圖維持不變，因為卡片式佈局已經很清晰
    const cardsHtml = `<div class="grid grid-cols-1 gap-4 sm:hidden">${holdingsArray.map(h => { 
        const isShort = h.quantity < 0;
        const note = stockNotes[h.symbol] || {}; 
        const decimals = isTwStock(h.symbol) ? 0 : 2; 
        const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
        const dailyReturnClass = h.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';
        let priceClass = '';
        if (isShort) {
             if (note.target_price && h.currentPriceOriginal <= note.target_price) priceClass = 'bg-green-100 text-green-800 rounded px-1';
             else if (note.stop_loss_price && h.currentPriceOriginal >= note.stop_loss_price) priceClass = 'bg-red-100 text-red-800 rounded px-1';
        } else {
             if (note.target_price && h.currentPriceOriginal >= note.target_price) priceClass = 'bg-green-100 text-green-800 rounded px-1';
             else if (note.stop_loss_price && h.currentPriceOriginal <= note.stop_loss_price) priceClass = 'bg-red-100 text-red-800 rounded px-1';
        }
        return `
            <div class="bg-white rounded-lg shadow p-4 space-y-3 ${isShort ? 'ring-2 ring-sky-300' : ''}">
                <div class="flex justify-between items-center">
                    <div class="flex items-center">
                        <h3 class="font-bold text-lg text-indigo-600">${h.symbol}</h3>
                        ${isShort ? shortBadge : ''}
                        <button class="ml-2 open-notes-btn" data-symbol="${h.symbol}"><i data-lucide="notebook-pen" class="w-5 h-5 text-gray-400 hover:text-indigo-600"></i></button>
                    </div>
                    <span class="font-semibold text-lg ${returnClass}">${(h.returnRate || 0).toFixed(2)}%</span>
                </div>
                <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div><p class="text-gray-500">當日損益</p><p class="font-medium ${dailyReturnClass}">${formatNumber(h.daily_pl_twd, 0)} (${(h.daily_change_percent || 0).toFixed(2)}%)</p></div>
                    <div><p class="text-gray-500">未實現損益</p><p class="font-medium ${returnClass}">${formatNumber(h.unrealizedPLTWD, 0)}</p></div>
                    <div><p class="text-gray-500">市值 (TWD)</p><p class="font-medium text-gray-800">${formatNumber(h.marketValueTWD, 0)}</p></div>
                    <div><p class="text-gray-500">現價 (${h.currency})</p><p class="font-medium text-gray-800"><span class="${priceClass}">${formatNumber(h.currentPriceOriginal, 2)}</span></p></div>
                    <div><p class="text-gray-500">平均成本/放空價</p><p class="font-medium text-gray-800">${formatNumber(h.avgCostOriginal, 2)}</p></div>
                    <div><p class="text-gray-500">持股佔比</p><p class="font-medium text-gray-800">${h.portfolioPercentage.toFixed(2)}%</p></div>
                </div>
            </div>`; }).join('')}</div>`;
    
    container.innerHTML = tableHtml + cardsHtml;
    lucide.createIcons();
}
