// =========================================================================================
// == 持股詳情彈窗 UI 模組 (detailsModal.ui.js) - v2.0 (Note Feature Removed)
// =========================================================================================

import { getState } from '../../state.js';
import { stagingService } from '../../staging.service.js'; // 【新增】導入暫存區服務
import { formatNumber, isTwStock } from '../utils.js';

/**
 * 【核心修改】渲染交易歷史分頁的內容 (改為 async)
 * @param {string} symbol - 股票代碼
 * @returns {Promise<string>} - HTML string
 */
async function renderDetailsTransactions(symbol) {
    const { transactions } = getState();
    const upperSymbol = symbol.toUpperCase();

    // 1. 從暫存區獲取交易相關的操作
    const stagedActions = await stagingService.getStagedActions();
    const transactionActions = stagedActions.filter(a => a.entity === 'transaction' && a.payload.symbol.toUpperCase() === upperSymbol);
    const stagedActionMap = new Map();
    transactionActions.forEach(action => {
        stagedActionMap.set(action.payload.id, action);
    });

    // 2. 結合 state 中的數據和暫存區的數據
    let combinedTransactions = transactions.filter(t => t.symbol.toUpperCase() === upperSymbol);

    stagedActionMap.forEach((action, txId) => {
        const existingIndex = combinedTransactions.findIndex(t => t.id === txId);
        
        if (action.type === 'CREATE') {
            if (existingIndex === -1) {
                combinedTransactions.push({ ...action.payload, _staging_status: 'CREATE' });
            }
        } else if (action.type === 'UPDATE') {
            if (existingIndex > -1) {
                combinedTransactions[existingIndex] = { ...combinedTransactions[existingIndex], ...action.payload, _staging_status: 'UPDATE' };
            }
        } else if (action.type === 'DELETE') {
            if (existingIndex > -1) {
                combinedTransactions[existingIndex]._staging_status = 'DELETE';
            }
        }
    });
    
    // 3. 按日期重新排序
    combinedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (combinedTransactions.length === 0) {
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
    
    const tableBody = combinedTransactions.map(t => {
        // 【新增】根據暫存狀態決定背景色和樣式
        let stagingClass = '';
        if (t._staging_status === 'CREATE') stagingClass = 'bg-staging-create';
        else if (t._staging_status === 'UPDATE') stagingClass = 'bg-staging-update';
        else if (t._staging_status === 'DELETE') stagingClass = 'bg-staging-delete opacity-70';

        const typeClass = t.type === 'buy' ? 'text-red-500' : 'text-green-500';
        const typeText = t.type === 'buy' ? '買入' : '賣出';
        
        return `
            <tr class="border-b border-gray-200 ${stagingClass}">
                <td class="px-4 py-2 whitespace-nowrap">${t.date.split('T')[0]}</td>
                <td class="px-4 py-2 font-semibold ${typeClass}">${typeText}</td>
                <td class="px-4 py-2 text-right">${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td>
                <td class="px-4 py-2 text-right">${formatNumber(t.price, 2)} <span class="text-xs text-gray-400">${t.currency}</span></td>
                <td class="px-4 py-2 text-center whitespace-nowrap">
                    <button data-id="${t.id}" class="details-edit-tx-btn text-indigo-600 hover:text-indigo-900 text-sm font-medium">編輯</button>
                    <button data-id="${t.id}" class="details-delete-tx-btn text-red-600 hover:text-red-900 text-sm font-medium ml-3">刪除</button>
                </td>
            </tr>`;
    }).join('');

    return `<div class="overflow-y-auto max-h-64"><table class="min-w-full">${tableHeader}<tbody class="bg-white">${tableBody}</tbody></table></div>`;
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
 * 【核心修改】渲染整個持股詳情彈出視窗 (改為 async)
 * @param {string} symbol - 要顯示詳情的股票代碼
 */
export async function renderDetailsModal(symbol) {
    const { holdings } = getState();
    const holding = holdings[symbol];
    if (!holding) return;

    const container = document.getElementById('details-modal-content');
    
    const returnClass = holding.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600';
    const dailyReturnClass = holding.daily_pl_twd >= 0 ? 'text-red-600' : 'text-green-600';

    // ========================= 【核心修改 - 開始】 =========================
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
                    <a href="#" data-tab="dividends" class="details-tab-item whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">股利紀錄</a>
                </nav>
            </div>
            <div id="details-modal-tab-content" class="mt-4">
                </div>
        </div>
    `;
    // ========================= 【核心修改 - 結束】 =========================
    
    container.innerHTML = modalHtml;
    lucide.createIcons();

    const tabContentContainer = document.getElementById('details-modal-tab-content');
    // 【核心修改】等待異步函式完成並設置其回傳的 HTML
    tabContentContainer.innerHTML = await renderDetailsTransactions(symbol);
}

/**
 * 【核心修改】處理詳情彈窗內部的分頁切換 (改為 async)
 * @param {string} tabName - 'transactions', 'notes', or 'dividends'
 * @param {string} symbol - 股票代碼
 */
export async function switchDetailsTab(tabName, symbol) {
    const tabContentContainer = document.getElementById('details-modal-tab-content');
    
    // Switch content
    // ========================= 【核心修改 - 開始】 =========================
    if (tabName === 'transactions') {
        // 【核心修改】等待異步函式完成
        tabContentContainer.innerHTML = await renderDetailsTransactions(symbol);
    } else if (tabName === 'dividends') {
        tabContentContainer.innerHTML = renderDetailsDividends(symbol);
    }
    // ========================= 【核心修改 - 結束】 =========================

    // Update active tab style
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
