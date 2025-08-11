// =========================================================================================
// == UI 渲染與互動模組 (ui.js) v3.5.5 - Refactoring
// =========================================================================================

import { getState, setState } from './state.js';
import { isTwStock, formatNumber, findFxRateForFrontend, filterHistoryByDateRange } from './ui/utils.js';

// --- 主要 UI 函式 ---
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

export function openModal(modalId, isEdit = false, data = null) {
    const { stockNotes, pendingDividends, confirmedDividends } = getState();
    const formId = modalId.replace('-modal', '-form');
    const form = document.getElementById(formId);
    if (form) form.reset();

    if (modalId === 'transaction-modal') {
        document.getElementById('transaction-id').value = '';
        if (isEdit && data) {
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
    } else if (modalId === 'notes-modal') {
        const symbol = data.symbol;
        const note = stockNotes[symbol] || {};
        document.getElementById('notes-modal-title').textContent = `編輯 ${symbol} 的筆記與目標`;
        document.getElementById('notes-symbol').value = symbol;
        document.getElementById('target-price').value = note.target_price || '';
        document.getElementById('stop-loss-price').value = note.stop_loss_price || '';
        document.getElementById('notes-content').value = note.notes || '';
    } else if (modalId === 'dividend-modal') {
        const record = isEdit
            ? confirmedDividends.find(d => d.id === data.id)
            : pendingDividends[data.index];
        if (!record) return;

        document.getElementById('dividend-modal-title').textContent = isEdit ? `編輯 ${record.symbol} 的配息` : `確認 ${record.symbol} 的配息`;
        document.getElementById('dividend-id').value = record.id || '';
        document.getElementById('dividend-symbol').value = record.symbol;
        document.getElementById('dividend-ex-date').value = record.ex_dividend_date;
        document.getElementById('dividend-currency').value = record.currency;
        document.getElementById('dividend-quantity').value = record.quantity_at_ex_date;
        document.getElementById('dividend-original-amount-ps').value = record.amount_per_share;
        document.getElementById('dividend-info-symbol').textContent = record.symbol;
        document.getElementById('dividend-info-ex-date').textContent = record.ex_dividend_date.split('T')[0];
        document.getElementById('dividend-info-quantity').textContent = formatNumber(record.quantity_at_ex_date, isTwStock(record.symbol) ? 0 : 2);
        document.getElementById('dividend-info-amount-ps').textContent = `${formatNumber(record.amount_per_share, 4)} ${record.currency}`;

        if (isEdit) {
            document.getElementById('dividend-pay-date').value = record.pay_date.split('T')[0];
            document.getElementById('dividend-tax-rate').value = record.tax_rate || '';
            document.getElementById('dividend-total-amount').value = record.total_amount;
            document.getElementById('dividend-notes').value = record.notes || '';
        } else {
            document.getElementById('dividend-pay-date').value = record.ex_dividend_date.split('T')[0];
            const taxRate = isTwStock(record.symbol) ? 0 : 30;
            document.getElementById('dividend-tax-rate').value = taxRate;
            const totalAmount = record.amount_per_share * record.quantity_at_ex_date * (1 - taxRate / 100);
            document.getElementById('dividend-total-amount').value = totalAmount.toFixed(2);
            document.getElementById('dividend-notes').value = '';
        }
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
    lucide.createIcons({ nodes: [notification.querySelector('i')] });
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
        el.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
    });
    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeTab) {
        activeTab.classList.add('border-indigo-500', 'text-indigo-600');
        activeTab.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
    }
}
