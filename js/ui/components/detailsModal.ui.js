// =========================================================================================
// == 持股詳情彈窗 UI 模組 (detailsModal.ui.js) - v1.2 (同步暫存狀態)
// =========================================================================================

import { getState } from '../../state.js';
import { formatNumber, isTwStock } from '../utils.js';

/**
 * 渲染交易歷史分頁的內容
 * @param {string} symbol - 股票代碼
 * @returns {string} - HTML string
 */
function renderDetailsTransactions(symbol) {
    const { transactions } = getState();
    const symbolTransactions = transactions.filter(t => t.symbol.toUpperCase() === symbol.toUpperCase());

    if (symbolTransactions.length === 0) {
        return `<p class="text-center py-6 text-gray-500">沒有此股票的交易紀錄。</p>`;
    }

    const tableHeader = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">日期</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">類型</th>
                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">股數</th>
                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">價格 (原幣)</th>
                <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
        </thead>`;
    
    // ========================= 【核心修改 - 開始】 =========================
    const tableBody = symbolTransactions.map(t => {
        const typeClass = t.type === 'buy' ? 'text-red-500' : 'text-green-500';
        const typeText = t.type === 'buy' ? '買入' : '賣出';

        // 新增：根據 status 決定行樣式和按鈕
        let rowClass = 'border-b border-gray-200';
        let buttonsHtml = '';
        
        switch (t.status) {
            case 'STAGED_CREATE':
                rowClass += ' bg-green-50';
                buttonsHtml = `<button data-change-id="${t.id}" class="revert-change-btn text-orange-600 hover:text-orange-900 text-sm font-medium">還原</button>`;
                break;
            case 'STAGED_UPDATE':
                rowClass += ' bg-yellow-50';
                buttonsHtml = `<button data-change-id="${t.id}" class="revert-change-btn text-orange-600 hover:text-orange-900 text-sm font-medium">還原</button>`;
                break;
            case 'STAGED_DELETE':
                rowClass += ' bg-red-50 opacity-60 line-through';
                buttonsHtml = `<button data-change-id="${t.id}" class="revert-change-btn text-orange-600 hover:text-orange-900 text-sm font-medium">還原</button>`;
                break;
            case 'FAILED':
                rowClass += ' bg-red-100 ring-1 ring-red-500';
                buttonsHtml = `<span class="text-red-600 font-bold text-sm">失敗</span>`;
                break;
            default: // COMMITTED
                buttonsHtml = `
                    <button data-id="${t.id}" class="details-edit-tx-btn text-indigo-600 hover:text-indigo-900 text-sm font-medium">編輯</button>
                    <button data-id="${t.id}" class="details-delete-tx-btn text-red-600 hover:text-red-900 text-sm font-medium ml-3">刪除</button>
                `;
                break;
        }

        return `
            <tr class="${rowClass}" title="${t.status || 'COMMITTED'}">
                <td class="px-4 py-2 whitespace-nowrap">${t.date.split('T')[0]}</td>
                <td class="px-4 py-2 font-semibold ${typeClass}">${typeText}</td>
                <td class="px-4 py-2 text-right">${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td>
                <td class="px-4 py-2 text-right">${formatNumber(t.price, 2)} <span class="text-xs text-gray-400">${t.currency}</span></td>
                <td class="px-4 py-2 text-center whitespace-nowrap">
                    ${buttonsHtml}
                </td>
            </tr>`;
    }).join('');
    // ========================= 【核心修改 - 結束】 =========================

    return `<div class="overflow-y-auto max-h-64"><table class="min-w-full">${tableHeader}<tbody class="bg-white">${tableBody}</tbody></table></div>`;
}

/**
 * 渲染投資筆記分頁的內容
 * @param {string} symbol - 股票代碼
 * @returns {string} - HTML string
 */
function renderDetailsNotes(symbol) {
    const { stockNotes } = getState();
    const note = stockNotes[symbol] || {};
    return `
        <div class="p-4">
            <form id="details-notes-form">
                <input type="hidden" id="details-notes-symbol" value="${symbol}">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label for="details-target-price" class="block text-sm font-medium text-gray-700">目標價</label>
                        <input type="number" step="any" id="details-target-price" value="${note.target_price || ''}" class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md">
                    </div>
                    <div>
                        <label for="details-stop-loss-price" class="block text-sm font-medium text-gray-700">停損價</label>
                        <input type="number" step="any" id="details-stop-loss-price" value="${note.stop_loss_price || ''}" class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md">
                    </div>
                </div>
                <div class="mb-4">
                    <label for="details-notes-content" class="block text-sm font-medium text-gray-700">投資筆記</label>
                    <textarea id="details-notes-content" rows="5" class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md">${note.notes || ''}</textarea>
                </div>
                <div class="flex justify-end">
                    <button type="submit" id="details-save-notes-btn" class="btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg">儲存筆記</button>
                </div>
            </form>
        </div>
    `;
}

/**
 * 渲染股利紀錄分頁的內容
 * @param {string} symbol - 股票代碼
 * @returns {string} - HTML string
 */
function renderDetailsDividends(symbol) {
    const { confirmedDividends } = getState();
    const symbolDividends = confirmedDividends.filter(d => d.symbol.toUpperCase() === symbol.toUpperCase());

    if (symbolDividends.length === 0) {
        return `<p class="text-center py-6 text-gray-500">沒有此股票的已確認配息紀錄。</p>`;
    }

    const tableHeader = `
        <thead class="bg-gray-50">
            <tr>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">發放日</th>
                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">實收總額 (原幣)</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">備註</th>
            </tr>
        </thead>`;

    const tableBody = symbolDividends.map(d => `
        <tr class="border-b border-gray-200">
            <td class="px-4 py-2 whitespace-nowrap">${d.pay_date.split('T')[0]}</td>
            <td class="px-4 py-2 text-right">${formatNumber(d.total_amount, 2)} <span class="text-xs text-gray-400">${d.currency}</span></td>
            <td class="px-4 py-2 text-sm text-gray-600 truncate max-w-xs">${d.notes || ''}</td>
        </tr>
    `).join('');

    return `<div class="overflow-y-auto max-h-64"><table class="min-w-full">${tableHeader}<tbody class="bg-white">${tableBody}</tbody></table></div>`;
}


/**
 * 渲染整個持股詳情彈出視窗
 * @param {string} symbol - 要顯示詳情的股票代碼
 */
export function renderDetailsModal(symbol) {
    const { holdings } = getState();
    const holding = holdings[symbol];
    if (!holding) return;

    const container = document.getElementById('details-modal-content');
    
    const returnClass = holding.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
    const dailyReturnClass = holding.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';

    const modalHtml = `
        <div class="flex justify-between items-center pb-4 border-b border-gray-200">
            <h2 class="text-2xl font-bold text-indigo-700">${symbol}</h2>
            <button id="close-details-modal-btn" class="p-1 rounded-full hover:bg-gray-200">
                <i data-lucide="x" class="w-6 h-6 text-gray-500"></i>
            </button>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
            <div class="p-3 bg-gray-50 rounded-lg">
                <p class="text-sm text-gray-500">市值 (TWD)</p>
                <p class="text-xl font-bold text-gray-800">${formatNumber(holding.marketValueTWD, 0)}</p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg">
                <p class="text-sm text-gray-500">未實現損益</p>
                <p class="text-xl font-bold ${returnClass}">${formatNumber(holding.unrealizedPLTWD, 0)}</p>
            </div>
             <div class="p-3 bg-gray-50 rounded-lg">
                <p class="text-sm text-gray-500">報酬率</p>
                <p class="text-xl font-bold ${returnClass}">${(holding.returnRate || 0).toFixed(2)}%</p>
            </div>
            <div class="p-3 bg-gray-50 rounded-lg">
                <p class="text-sm text-gray-500">當日損益</p>
                <p class="text-xl font-bold ${dailyReturnClass}">${formatNumber(holding.daily_pl_twd, 0)}</p>
            </div>
        </div>

        <div>
            <div class="border-b border-gray-200">
                <nav id="details-modal-tabs" class="-mb-px flex space-x-6">
                    <a href="#" data-tab="transactions" class="details-tab-item whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm border-indigo-500 text-indigo-600">交易歷史</a>
                    <a href="#" data-tab="notes" class="details-tab-item whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">投資筆記</a>
                    <a href="#" data-tab="dividends" class="details-tab-item whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">股利紀錄</a>
                </nav>
            </div>
            <div id="details-modal-tab-content" class="mt-4">
                </div>
        </div>
    `;
    
    container.innerHTML = modalHtml;
    lucide.createIcons();

    const tabContentContainer = document.getElementById('details-modal-tab-content');
    tabContentContainer.innerHTML = renderDetailsTransactions(symbol);
}

/**
 * 處理詳情彈窗內部的分頁切換
 * @param {string} tabName - 'transactions', 'notes', or 'dividends'
 * @param {string} symbol - 股票代碼
 */
export function switchDetailsTab(tabName, symbol) {
    const tabContentContainer = document.getElementById('details-modal-tab-content');
    
    if (tabName === 'transactions') {
        tabContentContainer.innerHTML = renderDetailsTransactions(symbol);
    } else if (tabName === 'notes') {
        tabContentContainer.innerHTML = renderDetailsNotes(symbol);
    } else if (tabName === 'dividends') {
        tabContentContainer.innerHTML = renderDetailsDividends(symbol);
    }

    document.querySelectorAll('.details-tab-item').forEach(el => {
        el.classList.remove('border-indigo-500', 'text-indigo-600');
        el.classList.add('border-transparent', 'text-gray-500');
    });
    const activeTab = document.querySelector(`.details-tab-item[data-tab="${tabName}"]`);
    if (activeTab) {
        activeTab.classList.add('border-indigo-500', 'text-indigo-600');
        activeTab.classList.remove('border-transparent', 'text-gray-500');
    }
}
