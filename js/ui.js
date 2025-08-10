// =========================================================================================
// == UI 渲染與互動模組 (ui.js) v3.6.0 - 新增群組UI
// =========================================================================================

import { getState, setState } from './state.js';

const baseChartOptions = {
    chart: { type: 'area', height: 350, zoom: { enabled: true }, toolbar: { show: true } },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    xaxis: {
        type: 'datetime',
        labels: {
            datetimeUTC: false,
            datetimeFormatter: { year: 'yyyy', month: "MMM", day: 'dd' }
        }
    },
    tooltip: { x: { format: 'yyyy-MM-dd' } }
};

// --- 輔助函式 ---
function isTwStock(symbol) { 
    return symbol ? symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO') : false; 
}

function formatNumber(value, decimals = 2) { 
    const num = Number(value); 
    if (isNaN(num)) return decimals === 0 ? '0' : '0.00'; 
    return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); 
}

function findFxRateForFrontend(currency, dateStr) {
    const { marketDataForFrontend } = getState();
    if (currency === 'TWD') return 1;
    const currencyToFx_FE = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
    const fxSym = currencyToFx_FE[currency];
    if (!fxSym || !marketDataForFrontend[fxSym]) return 1;
    const rates = marketDataForFrontend[fxSym].rates || {};
    if (rates[dateStr]) return rates[dateStr];
    let nearestDate = null;
    for (const rateDate in rates) {
        if (rateDate <= dateStr && (!nearestDate || rateDate > nearestDate)) {
            nearestDate = rateDate;
        }
    }
    return nearestDate ? rates[nearestDate] : 1;
}

function filterHistoryByDateRange(history, dateRange) {
    if (!history || Object.keys(history).length === 0) {
        return {};
    }

    const sortedDates = Object.keys(history).sort();
    const endDate = dateRange.type === 'custom' && dateRange.end ? new Date(dateRange.end) : new Date(sortedDates[sortedDates.length - 1]);
    let startDate;

    switch (dateRange.type) {
        case 'ytd':
            startDate = new Date(endDate.getFullYear(), 0, 1);
            break;
        case '1m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 1);
            break;
        case '3m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 3);
            break;
        case '6m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 6);
            break;
        case '1y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 1);
            break;
        case '3y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 3);
            break;
        case '5y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 5);
            break;
        case 'custom':
            startDate = dateRange.start ? new Date(dateRange.start) : new Date(sortedDates[0]);
            break;
        case 'all':
        default:
            startDate = new Date(sortedDates[0]);
            break;
    }

    const filteredHistory = {};
    for (const dateStr of sortedDates) {
        const currentDate = new Date(dateStr);
        if (currentDate >= startDate && currentDate <= endDate) {
            filteredHistory[dateStr] = history[dateStr];
        }
    }
    return filteredHistory;
}

export function getDateRangeForPreset(history, dateRange) {
    if (!history || Object.keys(history).length === 0) {
        return { startDate: '', endDate: '' };
    }
    const toYYYYMMDD = (date) => date.toISOString().split('T')[0];

    const sortedDates = Object.keys(history).sort();
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];

    const endDate = dateRange.type === 'custom' && dateRange.end ? new Date(dateRange.end) : new Date(lastDate);
    let startDate;

    switch (dateRange.type) {
        case 'ytd':
            startDate = new Date(endDate.getFullYear(), 0, 1);
            break;
        case '1m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 1);
            break;
        case '3m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 3);
            break;
        case '6m':
            startDate = new Date(endDate);
            startDate.setMonth(endDate.getMonth() - 6);
            break;
        case '1y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 1);
            break;
        case '3y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 3);
            break;
        case '5y':
            startDate = new Date(endDate);
            startDate.setFullYear(endDate.getFullYear() - 5);
            break;
        case 'all':
        default:
            startDate = new Date(firstDate);
            break;
    }
    
    if (startDate < new Date(firstDate)) {
        startDate = new Date(firstDate);
    }

    return {
        startDate: toYYYYMMDD(startDate),
        endDate: toYYYYMMDD(endDate)
    };
}

// --- 主要 UI 函式 ---
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
    const tableHtml = `<div class="overflow-x-auto hidden sm:block"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">股數</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">平均成本</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">現價</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="marketValueTWD">市值(TWD) ${getSortArrow('marketValueTWD')}</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="unrealizedPLTWD">未實現損益 ${getSortArrow('unrealizedPLTWD')}</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="returnRate">報酬率 ${getSortArrow('returnRate')}</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" data-sort-key="portfolioPercentage">持股佔比 ${getSortArrow('portfolioPercentage')}</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${holdingsArray.map(h => { const note = stockNotes[h.symbol] || {}; const decimals = isTwStock(h.symbol) ? 0 : 2; const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600'; let priceClass = ''; if (note.target_price && h.currentPriceOriginal >= note.target_price) priceClass = 'bg-green-100 text-green-800'; else if (note.stop_loss_price && h.currentPriceOriginal <= note.stop_loss_price) priceClass = 'bg-red-100 text-red-800'; return `
                            <tr class="hover:bg-gray-50">
                                <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 flex items-center">
                                    ${h.symbol}
                                    <button class="ml-2 open-notes-btn" data-symbol="${h.symbol}"><i data-lucide="notebook-pen" class="w-4 h-4 text-gray-400 hover:text-indigo-600"></i></button>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.quantity, decimals)}</td>
                                <td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.avgCostOriginal, 2)} <span class="text-xs text-gray-500">${h.currency}</span></td>
                                <td class="px-6 py-4 whitespace-nowrap ${priceClass}">${formatNumber(h.currentPriceOriginal, 2)} <span class="text-xs">${h.currency}</span></td>
                                <td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.marketValueTWD, 0)}</td>
                                <td class="px-6 py-4 whitespace-nowrap font-semibold ${returnClass}">${formatNumber(h.unrealizedPLTWD, 0)}</td>
                                <td class="px-6 py-4 whitespace-nowrap font-semibold ${returnClass}">${(h.returnRate || 0).toFixed(2)}%</td>
                                <td class="px-6 py-4 whitespace-nowrap">${h.portfolioPercentage.toFixed(2)}%</td>
                            </tr>`; }).join('')}</tbody></table></div>`;
    const cardsHtml = `<div class="grid grid-cols-1 gap-4 sm:hidden">${holdingsArray.map(h => { const note = stockNotes[h.symbol] || {}; const decimals = isTwStock(h.symbol) ? 0 : 2; const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600'; let priceClass = ''; if (note.target_price && h.currentPriceOriginal >= note.target_price) priceClass = 'bg-green-100 text-green-800 rounded px-1'; else if (note.stop_loss_price && h.currentPriceOriginal <= note.stop_loss_price) priceClass = 'bg-red-100 text-red-800 rounded px-1'; return `
                    <div class="bg-white rounded-lg shadow p-4 space-y-3">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center">
                                <h3 class="font-bold text-lg text-indigo-600">${h.symbol}</h3>
                                <button class="ml-2 open-notes-btn" data-symbol="${h.symbol}"><i data-lucide="notebook-pen" class="w-5 h-5 text-gray-400 hover:text-indigo-600"></i></button>
                            </div>
                            <span class="font-semibold text-lg ${returnClass}">${(h.returnRate || 0).toFixed(2)}%</span>
                        </div>
                        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                            <div><p class="text-gray-500">市值 (TWD)</p><p class="font-medium text-gray-800">${formatNumber(h.marketValueTWD, 0)}</p></div>
                            <div><p class="text-gray-500">未實現損益</p><p class="font-medium ${returnClass}">${formatNumber(h.unrealizedPLTWD, 0)}</p></div>
                            <div><p class="text-gray-500">股數</p><p class="font-medium text-gray-800">${formatNumber(h.quantity, decimals)}</p></div>
                            <div><p class="text-gray-500">現價 (${h.currency})</p><p class="font-medium text-gray-800"><span class="${priceClass}">${formatNumber(h.currentPriceOriginal, 2)}</span></p></div>
                             <div><p class="text-gray-500">平均成本</p><p class="font-medium text-gray-800">${formatNumber(h.avgCostOriginal, 2)}</p></div>
                             <div><p class="text-gray-500">持股佔比</p><p class="font-medium text-gray-800">${h.portfolioPercentage.toFixed(2)}%</p></div>
                        </div>
                    </div>`; }).join('')}</div>`;
    container.innerHTML = tableHtml + cardsHtml;
    lucide.createIcons();
}

export function renderTransactionsTable() {
    const { transactions, transactionFilter } = getState();
    const container = document.getElementById('transactions-tab');
    const uniqueSymbols = ['all', ...Array.from(new Set(transactions.map(t => t.symbol)))];
    const filterHtml = `<div class="mb-4 flex items-center space-x-2"><label for="transaction-symbol-filter" class="text-sm font-medium text-gray-700">篩選股票:</label><select id="transaction-symbol-filter" class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">${uniqueSymbols.map(s => `<option value="${s}" ${transactionFilter === s ? 'selected' : ''}>${s === 'all' ? '顯示全部' : s}</option>`).join('')}</select></div>`;
    const filteredTransactions = transactionFilter === 'all' ? transactions : transactions.filter(t => t.symbol === transactionFilter);
    const tableHtml = `<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">類型</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">股數</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">價格(原幣)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">群組標籤</th><th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th></tr></thead><tbody id="transactions-table-body" class="bg-white divide-y divide-gray-200">${filteredTransactions.length > 0 ? filteredTransactions.map(t => { const transactionDate = t.date.split('T')[0]; return `<tr class="hover:bg-gray-50"><td class="px-6 py-4">${transactionDate}</td><td class="px-6 py-4 font-medium">${t.symbol.toUpperCase()}</td><td class="px-6 py-4 font-semibold ${t.type === 'buy' ? 'text-red-500' : 'text-green-500'}">${t.type === 'buy' ? '買入' : '賣出'}</td><td class="px-6 py-4">${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td><td class="px-6 py-4">${formatNumber(t.price)} <span class="text-xs text-gray-500">${t.currency}</span></td><td class="px-6 py-4 text-xs text-gray-500">${t.group_tag || ''}</td><td class="px-6 py-4 text-center text-sm font-medium"><button data-id="${t.id}" class="edit-btn text-indigo-600 hover:text-indigo-900 mr-3">編輯</button><button data-id="${t.id}" class="delete-btn text-red-600 hover:text-red-900">刪除</button></td></tr>`; }).join('') : `<tr><td colspan="7" class="text-center py-10 text-gray-500">沒有符合條件的交易紀錄。</td></tr>`}</tbody></table></div>`;
    container.innerHTML = filterHtml + tableHtml;
}


export function renderSplitsTable() {
    const { userSplits } = getState();
    const tableBody = document.getElementById('splits-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    if (userSplits.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">沒有自定義拆股事件。</td></tr>`;
        return;
    }
    for (const s of userSplits) {
        const row = document.createElement('tr');
        row.className = "hover:bg-gray-50";
        row.innerHTML = `<td class="px-6 py-4 whitespace-nowrap">${s.date.split('T')[0]}</td><td class="px-6 py-4 whitespace-nowrap font-medium">${s.symbol.toUpperCase()}</td><td class="px-6 py-4 whitespace-nowrap">${s.ratio}</td><td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium"><button data-id="${s.id}" class="delete-split-btn text-red-600 hover:text-red-900">刪除</button></td>`;
        tableBody.appendChild(row);
    }
}

export function renderDividendsManagementTab(pending, confirmed) {
    const { dividendFilter } = getState();
    const container = document.getElementById('dividends-tab');
    const pendingHtml = `<div class="mb-8"><div class="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4"><h3 class="text-lg font-semibold text-gray-800">待確認配息</h3>${pending.length > 0 ? `<button id="bulk-confirm-dividends-btn" class="btn bg-teal-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-teal-700 flex items-center space-x-2"><i data-lucide="check-check" class="h-5 w-5"></i><span>一鍵全部以預設值確認</span></button>` : ''}</div><div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">除息日</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">當時股數</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">每股配息</th><th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${pending.length > 0 ? pending.map((p, index) => `<tr class="hover:bg-gray-50"><td class="px-4 py-4 font-medium">${p.symbol}</td><td class="px-4 py-4">${p.ex_dividend_date}</td><td class="px-4 py-4">${formatNumber(p.quantity_at_ex_date, isTwStock(p.symbol) ? 0 : 2)}</td><td class="px-4 py-4">${formatNumber(p.amount_per_share, 4)} <span class="text-xs text-gray-500">${p.currency}</span></td><td class="px-4 py-4 text-center"><button data-index="${index}" class="confirm-dividend-btn text-indigo-600 hover:text-indigo-900 font-medium">確認入帳</button></td></tr>`).join('') : `<tr><td colspan="5" class="text-center py-10 text-gray-500">沒有待處理的配息。</td></tr>`}</tbody></table></div></div>`;
    const confirmedSymbols = ['all', ...Array.from(new Set(confirmed.map(c => c.symbol)))];
    const filterHtml = `<div class="mb-4 flex items-center space-x-2"><label for="dividend-symbol-filter" class="text-sm font-medium text-gray-700">篩選股票:</label><select id="dividend-symbol-filter" class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">${confirmedSymbols.map(s => `<option value="${s}" ${dividendFilter === s ? 'selected' : ''}>${s === 'all' ? '顯示全部' : s}</option>`).join('')}</select></div>`;
    const filteredConfirmed = dividendFilter === 'all' ? confirmed : confirmed.filter(c => c.symbol === dividendFilter);
    const confirmedHtml = `<div><h3 class="text-lg font-semibold text-gray-800 mb-4">已確認 / 歷史配息</h3>${filterHtml}<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">發放日</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">實收總額</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">備註</th><th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${filteredConfirmed.length > 0 ? filteredConfirmed.map((c) => `<tr class="hover:bg-gray-50"><td class="px-4 py-4">${c.pay_date.split('T')[0]}</td><td class="px-4 py-4 font-medium">${c.symbol}</td><td class="px-4 py-4">${formatNumber(c.total_amount, c.currency === 'TWD' ? 0 : 2)} <span class="text-xs text-gray-500">${c.currency}</span></td><td class="px-4 py-4 text-sm text-gray-600 truncate max-w-xs">${c.notes || ''}</td><td class="px-4 py-4 text-center"><button data-id="${c.id}" class="edit-dividend-btn text-indigo-600 hover:text-indigo-900 mr-3">編輯</button><button data-id="${c.id}" class="delete-dividend-btn text-red-600 hover:text-red-900">刪除</button></td></tr>`).join('') : `<tr><td colspan="5" class="text-center py-10 text-gray-500">沒有符合條件的已確認配息紀錄。</td></tr>`}</tbody></table></div></div>`;
    container.innerHTML = pendingHtml + confirmedHtml;
    lucide.createIcons();
}

export function updateDashboard(summaryData, holdings) {
    const holdingsArray = Object.values(holdings || {});
    const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
    const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
    
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);
    
    const unrealizedEl = document.getElementById('unrealized-pl');
    unrealizedEl.textContent = formatNumber(totalUnrealizedPL, 0);
    unrealizedEl.className = `text-3xl font-bold mt-2 ${totalUnrealizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    const realizedEl = document.getElementById('realized-pl');
    const realizedPL = summaryData?.totalRealizedPL || 0;
    realizedEl.textContent = formatNumber(realizedPL, 0);
    realizedEl.className = `text-3xl font-bold mt-2 ${realizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    const totalReturnEl = document.getElementById('total-return');
    const overallReturn = summaryData?.overallReturnRate || 0;
    totalReturnEl.textContent = `${(overallReturn || 0).toFixed(2)}%`;
    totalReturnEl.className = `text-3xl font-bold mt-2 ${overallReturn >= 0 ? 'text-red-600' : 'text-green-600'}`;
    
    const xirrEl = document.getElementById('xirr-value');
    const xirr = summaryData?.xirr || 0;
    xirrEl.textContent = `${((xirr || 0) * 100).toFixed(2)}%`;
    xirrEl.className = `text-3xl font-bold mt-2 ${xirr >= 0 ? 'text-red-600' : 'text-green-600'}`;
}

export function initializeChart() {
    const options = {
        ...baseChartOptions,
        series: [{ name: '總資產', data: [] }],
        yaxis: { labels: { formatter: (value) => formatNumber(value, 0) } },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.3, stops: [0, 90, 100] } },
        colors: ['#4f46e5']
    };
    const chart = new ApexCharts(document.querySelector("#asset-chart"), options);
    chart.render();
    setState({ chart });
}

export function initializeTwrChart() {
    const options = {
        ...baseChartOptions,
        chart: { ...baseChartOptions.chart, type: 'line' },
        series: [{ name: '投資組合', data: [] }, { name: 'Benchmark', data: [] }],
        yaxis: { labels: { formatter: (value) => `${(value || 0).toFixed(2)}%` } },
        tooltip: { ...baseChartOptions.tooltip, y: { formatter: (value) => `${(value || 0).toFixed(2)}%` } },
        colors: ['#4f46e5', '#f59e0b']
    };
    const twrChart = new ApexCharts(document.querySelector("#twr-chart"), options);
    twrChart.render();
    setState({ twrChart });
}

export function initializeNetProfitChart(onClickHandler) {
    const options = {
        ...baseChartOptions,
        chart: { 
            ...baseChartOptions.chart, 
            events: { click: onClickHandler } 
        },
        series: [{ name: '累積淨利', data: [] }],
        yaxis: { labels: { formatter: (value) => formatNumber(value, 0) } },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.3, stops: [0, 90, 100] } },
        tooltip: { ...baseChartOptions.tooltip, y: { formatter: (value) => `TWD ${formatNumber(value, 0)}` } },
        colors: ['#10b981']
    };
    const netProfitChart = new ApexCharts(document.querySelector("#net-profit-chart"), options);
    netProfitChart.render();
    setState({ netProfitChart });
}

export function updateAssetChart(portfolioHistory = null) {
    const { chart, assetDateRange } = getState();
    if (!chart) return;
    const historyToUse = portfolioHistory ?? getState().portfolioHistory;
    const filteredHistory = filterHistoryByDateRange(historyToUse, assetDateRange);
    if (!filteredHistory || Object.keys(filteredHistory).length === 0) {
        chart.updateSeries([{ data: [] }]);
        return;
    }
    const chartData = Object.entries(filteredHistory).map(([date, value]) => [new Date(date).getTime(), value]);
    chart.updateSeries([{ data: chartData }]);
}

export function updateTwrChart(twrHistory = null, benchmarkHistory = null, benchmarkSymbol = 'SPY') {
    const { twrChart, twrDateRange } = getState();
    if (!twrChart) return;
    
    const twrHistoryToUse = twrHistory ?? getState().twrHistory;
    const benchmarkHistoryToUse = benchmarkHistory ?? getState().benchmarkHistory;

    const filteredTwrHistory = filterHistoryByDateRange(twrHistoryToUse, twrDateRange);
    const filteredBenchmarkHistory = filterHistoryByDateRange(benchmarkHistoryToUse, twrDateRange);

    const rebaseSeries = (history) => {
        if (!history || Object.keys(history).length === 0) return [];
        const sortedEntries = Object.entries(history).sort((a, b) => new Date(a[0]) - new Date(b[0]));
        const baseValue = sortedEntries[0][1];
        return sortedEntries.map(([date, value]) => [ new Date(date).getTime(), value - baseValue ]);
    };
    
    const isShowingFullHistory = Object.keys(twrHistoryToUse).length > 0 && Object.keys(twrHistoryToUse).length === Object.keys(filteredTwrHistory).length;
    
    let portfolioData;
    if (isShowingFullHistory) {
        const sortedEntries = Object.entries(filteredTwrHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
        portfolioData = sortedEntries.map(([date, value]) => [new Date(date).getTime(), value]);
    } else {
        portfolioData = rebaseSeries(filteredTwrHistory);
    }
    
    const rebasedBenchmarkData = rebaseSeries(filteredBenchmarkHistory);
    
    twrChart.updateSeries([
        { name: '投資組合', data: portfolioData },
        { name: `Benchmark (${benchmarkSymbol || '...'})`, data: rebasedBenchmarkData }
    ]);
}

export function updateNetProfitChart(netProfitHistory = null) {
    const { netProfitChart, netProfitDateRange } = getState();
    if (!netProfitChart) return;

    const historyToUse = netProfitHistory ?? getState().netProfitHistory;
    const filteredHistory = filterHistoryByDateRange(historyToUse, netProfitDateRange);
    if (!filteredHistory || Object.keys(filteredHistory).length === 0) {
        netProfitChart.updateSeries([{ data: [] }]);
        return;
    }

    const sortedEntries = Object.entries(filteredHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    
    const baseValue = sortedEntries[0][1];
    const chartData = sortedEntries.map(([date, value]) => [
        new Date(date).getTime(),
        value - baseValue
    ]);

    netProfitChart.updateSeries([{ data: chartData }]);
}

export function openModal(modalId, isEdit = false, data = null) { 
    const { stockNotes, pendingDividends, confirmedDividends, transactions } = getState();
    const formId = modalId.replace('-modal', '-form');
    const form = document.getElementById(formId);
    if (form) form.reset();
    
    if (modalId === 'transaction-modal') {
        document.getElementById('transaction-id').value = '';
        if(isEdit && data) {
            const tx = transactions.find(t => t.id === data.id);
            document.getElementById('modal-title').textContent = '編輯交易紀錄'; 
            document.getElementById('transaction-id').value = tx.id; 
            document.getElementById('transaction-date').value = tx.date.split('T')[0];
            document.getElementById('stock-symbol').value = tx.symbol; 
            document.querySelector(`input[name="transaction-type"][value="${tx.type}"]`).checked = true; 
            document.getElementById('quantity').value = tx.quantity; 
            document.getElementById('price').value = tx.price; 
            document.getElementById('currency').value = tx.currency;
            document.getElementById('exchange-rate').value = tx.exchangeRate || '';
            document.getElementById('total-cost').value = tx.totalCost || '';
            document.getElementById('group-tag').value = tx.group_tag || '';
        } else {
            document.getElementById('modal-title').textContent = '新增交易紀錄'; 
            document.getElementById('transaction-date').value = new Date().toISOString().split('T')[0];
        }
        toggleOptionalFields();
    } else if (modalId === 'split-modal') {
         document.getElementById('split-date').value = new Date().toISOString().split('T')[0];
    } else if (modalId === 'notes-modal') {
        const symbol = data.symbol;
        const note = stockNotes[symbol] || {};
        document.getElementById('notes-modal-title').textContent = `編輯 ${symbol} 的筆記與目標`;
        document.getElementById('notes-symbol').value = symbol;
        document.getElementById('target-price').value = note.target_price || '';
        document.getElementById('stop-loss-price').value = note.stop_loss_price || '';
        document.getElementById('notes-content').value = note.notes || '';
    } else if (modalId === 'dividend-modal') {
        // ... (此部分邏輯不變)
    }
    document.getElementById(modalId).classList.remove('hidden');
}


export function closeModal(modalId) { /* ... */ }
export function showConfirm(message, callback) { /* ... */ }
export function hideConfirm() { /* ... */ }
export function toggleOptionalFields() { /* ... */ }
export function showNotification(type, message) { /* ... */ }
export function switchTab(tabName) { /* ... */ }
export function updateDividendsTabIndicator() { /* ... */ }


// --- 【全新】群組功能 UI 函式 ---

/**
 * 用指定的數據更新整個儀表板的 UI
 * @param {object} data - 後端計算回傳的完整數據物件
 */
export function updateUIWithData(data) {
    const holdingsObject = (data.holdingsToUpdate || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});

    renderHoldingsTable(holdingsObject);
    updateDashboard(data.summaryData, holdingsObject);
    updateAssetChart(data.newFullHistory);
    updateTwrChart(data.twrHistory, data.benchmarkHistory, data.summaryData?.benchmarkSymbol);
    updateNetProfitChart(data.netProfitHistory);
}

/**
 * 渲染儀表板頂部的群組篩選器
 */
export function renderGroupFilter() {
    const { groups, selectedGroupId } = getState();
    const select = document.getElementById('group-filter-select');
    if (!select) return;
    select.innerHTML = '<option value="_all_">全部持股</option>'; // Reset
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        if (group.id === selectedGroupId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

/**
 * 渲染群組管理彈出視窗的內容
 */
export function renderGroupManagementModal() {
    const { groups } = getState();
    const listContainer = document.getElementById('groups-list');
    const editor = document.getElementById('group-editor');

    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    editor.classList.add('hidden'); // 每次重新渲染時都先隱藏編輯器

    if (groups.length === 0) {
        listContainer.innerHTML = '<p class="text-gray-500 text-center py-4">尚未建立任何群組。</p>';
    } else {
        groups.forEach(group => {
            const groupEl = document.createElement('div');
            groupEl.className = 'p-3 border rounded-md hover:bg-gray-50 cursor-pointer flex justify-between items-center';
            groupEl.dataset.groupId = group.id;
            groupEl.innerHTML = `<span>${group.name}</span> <i data-lucide="chevron-right" class="h-4 w-4 text-gray-400"></i>`;
            listContainer.appendChild(groupEl);
        });
    }
    lucide.createIcons();
}
