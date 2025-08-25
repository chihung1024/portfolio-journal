// =========================================================================================
// == 檔案：js/ui/components/groups.ui.js (v2.4 - 修正撤銷按鈕 class)
// == 職責：處理群組管理分頁和彈出視窗的 UI 渲染
// =========================================================================================

import { getState } from '../../state.js';

/**
 * 渲染群組管理分頁的內容，現在能夠識別並顯示暫存狀態
 */
export function renderGroupsTab() {
    const { groups } = getState();
    const container = document.getElementById('groups-content');
    if (!container) return;

    if (!groups || groups.length === 0) {
        container.innerHTML = `<div class="text-center py-10 text-gray-500">
            <i data-lucide="folder-search" class="w-12 h-12 mx-auto text-gray-400"></i>
            <p class="mt-4">尚未建立任何群組。</p>
            <button id="add-new-group-btn-empty" class="btn btn-primary mt-4">建立第一個群組</button>
        </div>`;
        lucide.createIcons();
        return;
    }

    container.innerHTML = groups.map(group => {
        const { status, changeId, name, description, transactionIds } = group;
        const isStaged = status && status !== 'COMMITTED';

        let statusBadge = '';
        let bgClass = 'bg-white';
        let nameClass = 'text-gray-800';
        let buttons = `
            <button data-group-id="${group.id}" class="edit-group-btn btn p-2 text-gray-500 hover:text-indigo-600" title="編輯群組">
                <i data-lucide="edit" class="w-5 h-5"></i>
            </button>
            <button data-group-id="${group.id}" class="delete-group-btn btn p-2 text-gray-500 hover:text-red-600" title="刪除群組">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
        `;

        if (isStaged) {
            // ========================= 【核心修正 - 開始】 =========================
            // 修正 class 名稱以匹配 group.events.js 中的事件監聽器
            buttons = `<button data-change-id="${changeId}" class="revert-change-btn btn btn-sm btn-secondary-outline">撤銷變更</button>`;
            // ========================= 【核心修正 - 結束】 =========================
        }

        switch (status) {
            case 'STAGED_CREATE':
                bgClass = 'bg-green-50 border-green-200';
                statusBadge = '<span class="bg-green-100 text-green-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full">新增待提交</span>';
                break;
            case 'STAGED_UPDATE':
                bgClass = 'bg-yellow-50 border-yellow-200';
                statusBadge = '<span class="bg-yellow-100 text-yellow-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full">修改待提交</span>';
                break;
            case 'STAGED_DELETE':
                bgClass = 'bg-red-50 border-red-200 opacity-70';
                nameClass += ' line-through';
                statusBadge = '<span class="bg-red-100 text-red-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full">刪除待提交</span>';
                break;
        }

        return `
            <div class="${bgClass} border rounded-lg p-4 flex justify-between items-center transition-all duration-200">
                <div>
                    <h4 class="font-bold text-lg ${nameClass}">${name} ${statusBadge}</h4>
                    <p class="text-sm text-gray-600 mt-1">${description || '沒有描述'}</p>
                    <div class="mt-2 text-xs text-gray-500">
                        <span>共 <strong>${(transactionIds || []).length}</strong> 筆交易</span>
                    </div>
                </div>
                <div class="flex-shrink-0 flex items-center space-x-2 ml-4">
                    ${buttons}
                </div>
            </div>
        `;
    }).join('');

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
    
    const txsBySymbol = transactions.reduce((acc, tx) => {
        if(tx.status === 'STAGED_DELETE') return acc; // 不顯示待刪除的交易
        if (!acc[tx.symbol]) {
            acc[tx.symbol] = [];
        }
        acc[tx.symbol].push(tx);
        return acc;
    }, {});

    const allSymbols = Object.keys(txsBySymbol).sort();
    
    const includedTxIds = new Set(groupToEdit ? groupToEdit.transactionIds : []);

    if (allSymbols.length > 0) {
        symbolsContainer.innerHTML = `
            <div id="group-tree-view" class="p-2">
                ${allSymbols.map(symbol => {
                    const symbolTxs = txsBySymbol[symbol];
                    const includedCount = symbolTxs.filter(t => includedTxIds.has(t.id)).length;
                    const isAllChecked = includedCount === symbolTxs.length && symbolTxs.length > 0;

                    return `
                        <div class="symbol-node" data-symbol="${symbol}">
                            <div class="flex items-center p-1 rounded-md hover:bg-gray-100">
                                <i data-lucide="chevron-right" class="w-4 h-4 mr-1 cursor-pointer expand-symbol-btn"></i>
                                <label class="flex items-center space-x-3 flex-grow cursor-pointer">
                                    <input type="checkbox" name="group_symbol" value="${symbol}" class="h-4 w-4 symbol-checkbox" ${isAllChecked ? 'checked' : ''}>
                                    <span class="font-mono text-sm font-medium text-gray-800">${symbol}</span>
                                    <span class="text-xs text-gray-400">(${includedCount}/${symbolTxs.length})</span>
                                </label>
                            </div>
                            <div class="transaction-list hidden pl-6 border-l border-gray-200 ml-2">
                                ${symbolTxs.sort((a,b) => new Date(b.date) - new Date(a.date)).map(tx => {
                                    const isChecked = includedTxIds.has(tx.id);
                                    const typeClass = tx.type === 'buy' ? 'text-red-500' : 'text-green-500';
                                    return `
                                        <div class="transaction-node p-1" data-tx-id="${tx.id}">
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
        
        symbolsContainer.querySelectorAll('.symbol-checkbox').forEach(cb => {
            const symbolNode = cb.closest('.symbol-node');
            const includedCount = symbolNode.querySelectorAll('.transaction-checkbox:checked').length;
            const totalCount = symbolNode.querySelectorAll('.transaction-checkbox').length;
            if(includedCount > 0 && includedCount < totalCount){
                cb.indeterminate = true;
            }
        });
    } else {
        symbolsContainer.innerHTML = `<p class="text-center text-sm text-gray-500 py-4">您的投資組合中還沒有任何交易，無法選擇股票。</p>`;
    }
    
    lucide.createIcons();
}
