// =========================================================================================
// == UI 渲染與互動模組 (ui.js)
// =========================================================================================

import { getState, setState } from './state.js';

// --- 輔助函式 ---
function isTwStock(symbol) { 
    return symbol ? symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO') : false; 
}

function formatNumber(value, decimals = 2) { 
    const num = Number(value); 
    if (isNaN(num)) return decimals === 0 ? '0' : '0.00'; 
    return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); 
}

const currencyToFx_FE = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
function findFxRateForFrontend(currency, dateStr) {
    const { marketDataForFrontend } = getState();
    if (currency === 'TWD') return 1;
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

// --- 主要 UI 函式 ---

export function renderHoldingsTable(currentHoldings) {
    const { stockNotes } = getState(); // [修改] 獲取筆記資料
    const container = document.getElementById('holdings-content');
    container.innerHTML = '';

    const holdingsArray = Object.values(currentHoldings);
    if (holdingsArray.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">沒有持股紀錄，請新增一筆交易。</p>`;
        return;
    }
    holdingsArray.sort((a,b) => b.marketValueTWD - a.marketValueTWD);

    const tableHtml = `
        <div class="overflow-x-auto hidden sm:block">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">股數</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">平均成本(原幣)</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">現價(原幣)</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">市值(TWD)</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">未實現損益(TWD)</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">報酬率</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    ${holdingsArray.map(h => {
                        const note = stockNotes[h.symbol] || {};
                        const decimals = isTwStock(h.symbol) ? 0 : 2;
                        const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
                        
                        // [修改] 價格提示邏輯
                        let priceClass = '';
                        if (note.target_price && h.currentPriceOriginal >= note.target_price) {
                            priceClass = 'bg-green-100 text-green-800';
                        } else if (note.stop_loss_price && h.currentPriceOriginal <= note.stop_loss_price) {
                            priceClass = 'bg-red-100 text-red-800';
                        }

                        return `
                            <tr class="hover:bg-gray-50">
                                <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 flex items-center">
                                    ${h.symbol}
                                    <button class="ml-2 open-notes-btn" data-symbol="${h.symbol}">
                                        <i data-lucide="notebook-pen" class="w-4 h-4 text-gray-400 hover:text-indigo-600"></i>
                                    </button>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.quantity, decimals)}</td>
                                <td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.avgCostOriginal, 2)} <span class="text-xs text-gray-500">${h.currency}</span></td>
                                <td class="px-6 py-4 whitespace-nowrap ${priceClass}">${formatNumber(h.currentPriceOriginal, 2)} <span class="text-xs">${h.currency}</span></td>
                                <td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.marketValueTWD, 0)}</td>
                                <td class="px-6 py-4 whitespace-nowrap font-semibold ${returnClass}">${formatNumber(h.unrealizedPLTWD, 0)}</td>
                                <td class="px-6 py-4 whitespace-nowrap font-semibold ${returnClass}">${(h.returnRate || 0).toFixed(2)}%</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    const cardsHtml = `
        <div class="grid grid-cols-1 gap-4 sm:hidden">
            ${holdingsArray.map(h => {
                const note = stockNotes[h.symbol] || {};
                const decimals = isTwStock(h.symbol) ? 0 : 2;
                const returnClass = h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';

                // [修改] 價格提示邏輯
                let priceClass = '';
                if (note.target_price && h.currentPriceOriginal >= note.target_price) {
                    priceClass = 'bg-green-100 text-green-800 rounded px-1';
                } else if (note.stop_loss_price && h.currentPriceOriginal <= note.stop_loss_price) {
                    priceClass = 'bg-red-100 text-red-800 rounded px-1';
                }

                return `
                    <div class="bg-white rounded-lg shadow p-4 space-y-3">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center">
                                <h3 class="font-bold text-lg text-indigo-600">${h.symbol}</h3>
                                <button class="ml-2 open-notes-btn" data-symbol="${h.symbol}">
                                    <i data-lucide="notebook-pen" class="w-5 h-5 text-gray-400 hover:text-indigo-600"></i>
                                </button>
                            </div>
                            <span class="font-semibold text-lg ${returnClass}">${(h.returnRate || 0).toFixed(2)}%</span>
                        </div>
                        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                            <div>
                                <p class="text-gray-500">市值 (TWD)</p>
                                <p class="font-medium text-gray-800">${formatNumber(h.marketValueTWD, 0)}</p>
                            </div>
                            <div>
                                <p class="text-gray-500">未實現損益</p>
                                <p class="font-medium ${returnClass}">${formatNumber(h.unrealizedPLTWD, 0)}</p>
                            </div>
                            <div>
                                <p class="text-gray-500">股數</p>
                                <p class="font-medium text-gray-800">${formatNumber(h.quantity, decimals)}</p>
                            </div>
                            <div>
                                <p class="text-gray-500">現價 (${h.currency})</p>
                                <p class="font-medium text-gray-800"><span class="${priceClass}">${formatNumber(h.currentPriceOriginal, 2)}</span></p>
                            </div>
                             <div>
                                <p class="text-gray-500">平均成本</p>
                                <p class="font-medium text-gray-800">${formatNumber(h.avgCostOriginal, 2)}</p>
                            </div>
                             <div>
                                <p class="text-gray-500">總成本 (TWD)</p>
                                <p class="font-medium text-gray-800">${formatNumber(h.totalCostTWD, 0)}</p>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    container.innerHTML = tableHtml + cardsHtml;
    // [修改] 重新渲染 Lucide 圖示
    lucide.createIcons();
}

// ... (renderTransactionsTable, renderSplitsTable, updateDashboard, etc. 保持不變)

export function renderTransactionsTable() {
    const { transactions } = getState();
    const tableBody = document.getElementById('transactions-table-body');
    tableBody.innerHTML = '';
    if (transactions.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-500">沒有交易紀錄。</td></tr>`;
        return;
    }
    for (const t of transactions) {
        const row = document.createElement('tr');
        row.className = "hover:bg-gray-50";
        const transactionDate = t.date.split('T')[0];
        const fxRate = t.exchangeRate || findFxRateForFrontend(t.currency, transactionDate);
        const totalAmountTWD = (t.totalCost || (t.quantity * t.price)) * fxRate;

        row.innerHTML = `<td class="px-6 py-4 whitespace-nowrap">${transactionDate}</td><td class="px-6 py-4 whitespace-nowrap font-medium">${t.symbol.toUpperCase()}</td><td class="px-6 py-4 whitespace-nowrap font-semibold ${t.type === 'buy' ? 'text-red-500' : 'text-green-500'}">${t.type === 'buy' ? '買入' : '賣出'}</td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(t.price)} <span class="text-xs text-gray-500">${t.currency}</span></td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(totalAmountTWD, 0)}</td><td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium"><button data-id="${t.id}" class="edit-btn text-indigo-600 hover:text-indigo-900 mr-3">編輯</button><button data-id="${t.id}" class="delete-btn text-red-600 hover:text-red-900">刪除</button></td>`;
        tableBody.appendChild(row);
    };
}

export function renderSplitsTable() {
    const { userSplits } = getState();
    const tableBody = document.getElementById('splits-table-body');
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
export function updateDashboard(currentHoldings, realizedPL, overallReturn, xirr) {
    const holdingsArray = Object.values(currentHoldings);
    const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
    const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
    document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);
    const unrealizedEl = document.getElementById('unrealized-pl');
    unrealizedEl.textContent = formatNumber(totalUnrealizedPL, 0);
    unrealizedEl.className = `text-3xl font-bold mt-2 ${totalUnrealizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    const realizedEl = document.getElementById('realized-pl');
    realizedEl.textContent = formatNumber(realizedPL, 0);
    realizedEl.className = `text-3xl font-bold mt-2 ${realizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
    const totalReturnEl = document.getElementById('total-return');
    totalReturnEl.textContent = `${(overallReturn || 0).toFixed(2)}%`;
    totalReturnEl.className = `text-3xl font-bold mt-2 ${overallReturn >= 0 ? 'text-red-600' : 'text-green-600'}`;
    const xirrEl = document.getElementById('xirr-value');
    xirrEl.textContent = `${((xirr || 0) * 100).toFixed(2)}%`;
    xirrEl.className = `text-3xl font-bold mt-2 ${xirr >= 0 ? 'text-red-600' : 'text-green-600'}`;
}

export function initializeChart() {
    const options = { chart: { type: 'area', height: 350, zoom: { enabled: true }, toolbar: { show: true } }, series: [{ name: '總資產', data: [] }], xaxis: { type: 'datetime', labels: { datetimeUTC: false, format: 'yy/MM/dd' } }, yaxis: { labels: { formatter: (value) => { return formatNumber(value, 0) } } }, dataLabels: { enabled: false }, stroke: { curve: 'smooth', width: 2 }, fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.3, stops: [0, 90, 100] } }, tooltip: { x: { format: 'yyyy/MM/dd' }, y: { formatter: (value) => { return formatNumber(value,0) } } }, colors: ['#4f46e5'] };
    const chart = new ApexCharts(document.querySelector("#asset-chart"), options);
    chart.render();
    setState({ chart });
}

export function initializeTwrChart() {
    const options = { chart: { type: 'line', height: 350, zoom: { enabled: true }, toolbar: { show: true } }, series: [{ name: '投資組合', data: [] }, { name: 'Benchmark', data: [] }], xaxis: { type: 'datetime', labels: { datetimeUTC: false, format: 'yy/MM/dd' } }, yaxis: { labels: { formatter: (value) => `${(value || 0).toFixed(2)}%` } }, dataLabels: { enabled: false }, stroke: { curve: 'smooth', width: 2 }, tooltip: { y: { formatter: (value) => `${(value || 0).toFixed(2)}%` } }, colors: ['#4f46e5', '#f59e0b'] };
    const twrChart = new ApexCharts(document.querySelector("#twr-chart"), options);
    twrChart.render();
    setState({ twrChart });
}

export function updateAssetChart(portfolioHistory) {
    const { chart } = getState();
    if (!portfolioHistory || Object.keys(portfolioHistory).length === 0) { if(chart) chart.updateSeries([{ data: [] }]); return; }
    const chartData = Object.entries(portfolioHistory).sort((a, b) => new Date(a[0]) - new Date(b[0])).map(([date, value]) => [new Date(date).getTime(), value]);
    if(chart) chart.updateSeries([{ data: chartData }]);
}

export function updateTwrChart(twrHistory, benchmarkHistory, benchmarkSymbol) {
    const { twrChart } = getState();
    const formatHistory = (history) => history ? Object.entries(history).sort((a, b) => new Date(a[0]) - new Date(b[0])).map(([date, value]) => [new Date(date).getTime(), value]) : [];
    if(twrChart) twrChart.updateSeries([ { name: '投資組合', data: formatHistory(twrHistory) }, { name: `Benchmark (${benchmarkSymbol || '...'})`, data: formatHistory(benchmarkHistory) } ]);
}

export function openModal(modalId, isEdit = false, data = null) { 
    const { stockNotes } = getState();
    const formId = modalId.replace('-modal', '-form');
    const form = document.getElementById(formId);
    if (form) form.reset();
    
    if (modalId === 'transaction-modal') {
        // ... (原有的 transaction modal 邏輯不變)
        document.getElementById('transaction-id').value = '';
        if(isEdit && data) {
            document.getElementById('modal-title').textContent = '編輯交易紀錄'; 
            document.getElementById('transaction-id').value = data.id; 
            document.getElementById('transaction-date').value = data.date.split('T')[0];
            document.getElementById('stock-symbol').value = data.symbol; 
            document.querySelector(`input[name="transaction-type"][value="${data.type}"]`).checked = true; 
            document.getElementById('quantity').value = data.quantity; 
            document.getElementById('price').value = data.price; 
            document.getElementById('currency').value = data.currency;
            document.getElementById('exchange-rate').value = data.exchangeRate || '';
            document.getElementById('total-cost').value = data.totalCost || '';
        } else {
            document.getElementById('modal-title').textContent = '新增交易紀錄'; 
            document.getElementById('transaction-date').value = new Date().toISOString().split('T')[0];
        }
        toggleOptionalFields();
    } else if (modalId === 'split-modal') {
         document.getElementById('split-date').value = new Date().toISOString().split('T')[0];
    } else if (modalId === 'notes-modal') { // [新增] 處理筆記視窗
        const symbol = data.symbol;
        const note = stockNotes[symbol] || {};
        document.getElementById('notes-modal-title').textContent = `編輯 ${symbol} 的筆記與目標`;
        document.getElementById('notes-symbol').value = symbol;
        document.getElementById('target-price').value = note.target_price || '';
        document.getElementById('stop-loss-price').value = note.stop_loss_price || '';
        document.getElementById('notes-content').value = note.notes || '';
    }
    
    document.getElementById(modalId).classList.remove('hidden');
}

export function closeModal(modalId) { 
    document.getElementById(modalId).classList.add('hidden');
}

export function showConfirm(message, callback) { 
    document.getElementById('confirm-message').textContent = message; 
    setState({ confirmCallback: callback });
    document.getElementById('confirm-modal').classList.remove('hidden'); 
}

export function hideConfirm() { 
    setState({ confirmCallback: null });
    document.getElementById('confirm-modal').classList.add('hidden'); 
}

export function toggleOptionalFields() {
    const currency = document.getElementById('currency').value;
    const exchangeRateField = document.getElementById('exchange-rate-field');
    if (currency === 'TWD') {
        exchangeRateField.style.display = 'none';
    } else {
        exchangeRateField.style.display = 'block';
    }
}

export function showNotification(type, message) { 
    const area = document.getElementById('notification-area'); 
    const color = type === 'success' ? 'bg-green-500' : (type === 'info' ? 'bg-blue-500' : 'bg-red-500'); 
    const icon = type === 'success' ? 'check-circle' : (type === 'info' ? 'info' : 'alert-circle'); 
    const notification = document.createElement('div'); 
    notification.className = `flex items-center ${color} text-white text-sm font-bold px-4 py-3 rounded-md shadow-lg mb-2`; 
    notification.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5 mr-2"></i><p>${message}</p>`; 
    area.appendChild(notification); 
    lucide.createIcons({nodes: [notification.querySelector('i')]});
    setTimeout(() => { 
        notification.style.transition = 'opacity 0.5s ease'; 
        notification.style.opacity = '0'; 
        setTimeout(() => notification.remove(), 500); 
    }, 5000); 
}

export function switchTab(tabName) { 
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden')); 
    document.getElementById(`${tabName}-tab`).classList.remove('hidden'); 
    document.querySelectorAll('.tab-item').forEach(el => { 
        el.classList.remove('border-indigo-500', 'text-indigo-600'); 
        el.classList.add('border-transparent', 'text-gray-500'); 
    }); 
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`); 
    activeTab.classList.add('border-indigo-500', 'text-indigo-600'); 
    activeTab.classList.remove('border-transparent', 'text-gray-500'); 
}
