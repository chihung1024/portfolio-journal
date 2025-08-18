// =========================================================================================
// == 檔案：js/ui/components/groups.ui.js (v2.0 - 樹狀選擇模型)
// == 職責：處理群組管理分頁和彈出視窗的 UI 渲染
// =========================================================================================

import { getState } from '../../state.js';

/**
 * 渲染群組管理分頁的內容
 */
export function renderGroupsTab() {
    const { groups } = getState();
    const container = document.getElementById('groups-content');
    if (!container) return;

    if (groups.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">尚未建立任何群組。</p>`;
        return;
    }

    container.innerHTML = groups.map(group => `
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 flex justify-between items-center">
            <div>
                <h4 class="font-bold text-lg text-gray-800">${group.name}</h4>
                <p class="text-sm text-gray-600 mt-1">${group.description || '沒有描述'}</p>
                <div class="mt-2 text-xs text-gray-500">
                    <span>包含 <strong>${group.symbols.length}</strong> 檔股票</span>
                    <span class="mx-2">|</span>
                    <span>共 <strong>${group.transaction_count}</strong> 筆交易</span>
                </div>
            </div>
            <div class="flex-shrink-0 flex items-center space-x-2 ml-4">
                <button data-group-id="${group.id}" class="edit-group-btn btn p-2 text-gray-500 hover:text-indigo-600">
                    <i data-lucide="edit" class="w-5 h-5"></i>
                </button>
                <button data-group-id="${group.id}" class="delete-group-btn btn p-2 text-gray-500 hover:text-red-600">
                    <i data-lucide="trash-2" class="w-5 h-5"></i>
                </button>
            </div>
        </div>
    `).join('');

    lucide.createIcons();
}

/**
 * 【核心重構】渲染群組編輯/新增彈出視窗的內容 (樹狀圖)
 * @param {Object|null} groupToEdit - (可選) 要編輯的群組物件
 */
export function renderGroupModal(groupToEdit = null) {
    const { transactions } = getState();
    const form = document.getElementById('group-form');
    form.reset();

    document.getElementById('group-id').value = groupToEdit ? groupToEdit.id : '';
    document.getElementById('group-modal-title').textContent = groupToEdit ? `編輯群組：${groupToEdit.name}` : '新增群組';
    document.getElementById('group-name').value = groupToEdit ? groupToEdit.name : '';
    document.getElementById('group-description').value = groupToEdit ? groupToEdit.description || '' : '';

    const symbolsContainer = document.getElementById('group-symbols-container');
    
    // 步驟 1: 將所有交易按股票代碼分組
    const txsBySymbol = transactions.reduce((acc, tx) => {
        if (!acc[tx.symbol]) {
            acc[tx.symbol] = [];
        }
        acc[tx.symbol].push(tx);
        return acc;
    }, {});

    const allSymbols = Object.keys(txsBySymbol).sort();
    
    // 步驟 2: 確定在編輯模式下，哪些交易是被包含的
    const includedTxIds = new Set(groupToEdit ? (groupToEdit.included_transactions || []).map(t => t.id) : []);

    if (allSymbols.length > 0) {
        // 【新增】加入篩選器和批量操作的 UI 結構
        symbolsContainer.innerHTML = `
            <div class="p-2 bg-gray-50 border-b border-gray-200 sticky top-0">
                <div class="flex items-center space-x-2">
                    <input type="text" id="group-tx-filter" placeholder="篩選交易 (例如: buy 2024-01)" class="w-full text-sm border-gray-300 rounded-md">
                    <button type="button" id="bulk-check-btn" class="btn text-xs bg-gray-200 px-2 py-1 rounded">全選結果</button>
                    <button type="button" id="bulk-uncheck-btn" class="btn text-xs bg-gray-200 px-2 py-1 rounded">反選結果</button>
                </div>
            </div>
            <div id="group-tree-view" class="p-2">
                ${allSymbols.map(symbol => {
                    const symbolTxs = txsBySymbol[symbol];
                    const includedCount = symbolTxs.filter(t => includedTxIds.has(t.id)).length;
                    const isAllChecked = includedCount === symbolTxs.length;
                    const isPartiallyChecked = includedCount > 0 && !isAllChecked;

                    return `
                        <div class="symbol-node" data-symbol="${symbol}">
                            <div class="flex items-center p-1 rounded-md hover:bg-gray-100">
                                <i data-lucide="chevron-right" class="w-4 h-4 mr-1 cursor-pointer expand-symbol-btn"></i>
                                <label class="flex items-center space-x-3 flex-grow cursor-pointer">
                                    <input type="checkbox" name="group_symbol" value="${symbol}" class="h-4 w-4 symbol-checkbox" ${isAllChecked ? 'checked' : ''} ${isPartiallyChecked ? 'data-indeterminate="true"' : ''}>
                                    <span class="font-mono text-sm font-medium text-gray-800">${symbol}</span>
                                    <span class="text-xs text-gray-400">(${includedCount}/${symbolTxs.length})</span>
                                </label>
                            </div>
                            <div class="transaction-list hidden pl-6 border-l border-gray-200 ml-2">
                                ${symbolTxs.map(tx => {
                                    const isChecked = includedTxIds.has(tx.id);
                                    const typeClass = tx.type === 'buy' ? 'text-red-500' : 'text-green-500';
                                    return `
                                        <div class="transaction-node p-1" data-tx-id="${tx.id}" data-tx-info="${tx.type} ${tx.date.split('T')[0]} ${tx.quantity}@${tx.price}">
                                            <label class="flex items-center space-x-3 text-xs cursor-pointer">
                                                <input type="checkbox" name="group_transaction" value="${tx.id}" class="h-4 w-4 transaction-checkbox" ${isChecked ? 'checked' : ''}>
                                                <span>${tx.date.split('T')[0]} <span class="${typeClass}">${tx.type}</span> ${tx.quantity} @ ${tx.price}</span>
                                            </label>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } else {
        symbolsContainer.innerHTML = `<p class="text-center text-sm text-gray-500 py-4">您的投資組合中還沒有任何交易，無法選擇股票。</p>`;
    }
    
    lucide.createIcons(); // 重新渲染 Chevron 圖示
}
