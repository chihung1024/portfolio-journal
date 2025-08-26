// =========================================================================================
// == 檔案：js/ui/components/groups.ui.js (v3.0 - 整合暫存區)
// =========================================================================================

import { getState } from '../../state.js';
import { stagingService } from '../../staging.service.js';

/**
 * 渲染群組管理分頁的內容
 */
export async function renderGroupsTab() {
    const { groups } = getState();
    const container = document.getElementById('groups-content');
    if (!container) return;

    const stagedActions = (await stagingService.getActions()).filter(a => a.entity === 'GROUP');
    const stagedCreates = stagedActions.filter(a => a.type === 'CREATE').map(a => a.payload);
    const stagedUpdates = new Map(stagedActions.filter(a => a.type === 'UPDATE').map(a => [a.payload.id, a.payload]));
    const stagedDeletes = new Set(stagedActions.filter(a => a.type === 'DELETE').map(a => a.payload.id));

    const displayGroups = [
        ...groups.map(g => stagedUpdates.has(g.id) ? { ...g, ...stagedUpdates.get(g.id) } : g),
        ...stagedCreates
    ];

    if (displayGroups.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-muted">尚未建立任何群組。</p>`;
        return;
    }

    container.innerHTML = displayGroups.map(group => {
        let cardClass = 'bg-light';
        let isDeleted = false;
        if (stagedDeletes.has(group.id)) {
            cardClass = 'bg-danger-subtle opacity-75';
            isDeleted = true;
        } else if (stagedUpdates.has(group.id)) {
            cardClass = 'bg-warning-subtle';
        } else if (group.id.startsWith('temp_')) {
            cardClass = 'bg-success-subtle';
        }

        return `
        <div class="card ${cardClass} mb-3">
            <div class="card-body d-flex justify-content-between align-items-center">
                <div>
                    <h5 class="card-title mb-1">${group.name}</h5>
                    <p class="card-text text-muted small">包含 ${group.transactionIds?.length || 0} 筆交易</p>
                </div>
                <div class="flex-shrink-0">
                    <button data-group-id="${group.id}" class="btn btn-sm btn-outline-primary edit-group-btn me-2" ${isDeleted ? 'disabled' : ''}>編輯</button>
                    <button data-group-id="${group.id}" class="btn btn-sm btn-outline-danger delete-group-btn" ${isDeleted ? 'disabled' : ''}>刪除</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

/**
 * 渲染群組編輯/新增彈出視窗的內容
 * @param {Object|null} groupToEdit - (可選) 要編輯的群組物件
 */
export async function renderGroupModal(groupToEdit = null) {
    const { transactions } = getState();
    const form = document.getElementById('group-form');
    form.reset();

    let finalGroupData = groupToEdit;

    // 如果是編輯模式，檢查暫存區是否有更新的版本
    if (groupToEdit && groupToEdit.id) {
        const stagedActions = (await stagingService.getActions()).filter(a => a.entity === 'GROUP' && a.type === 'UPDATE');
        const stagedUpdate = stagedActions.find(a => a.payload.id === groupToEdit.id);
        if (stagedUpdate) {
            finalGroupData = stagedUpdate.payload; // 優先使用暫存區的資料
        }
    }

    document.getElementById('group-id').value = finalGroupData ? finalGroupData.id : '';
    document.getElementById('group-modal-title').textContent = finalGroupData ? `編輯群組：${finalGroupData.name}` : '新增群組';
    document.getElementById('group-name').value = finalGroupData ? finalGroupData.name : '';

    const symbolsContainer = document.getElementById('group-symbols-container');
    const txsBySymbol = transactions.reduce((acc, tx) => {
        if (!acc[tx.symbol]) { acc[tx.symbol] = []; }
        acc[tx.symbol].push(tx);
        return acc;
    }, {});

    const includedTxIds = new Set(finalGroupData ? finalGroupData.transactionIds : []);

    symbolsContainer.innerHTML = Object.keys(txsBySymbol).sort().map(symbol => {
        const symbolTxs = txsBySymbol[symbol];
        const isAllChecked = symbolTxs.every(t => includedTxIds.has(t.id));
        return `
            <div class="mb-2">
                <div class="form-check">
                    <input class="form-check-input symbol-checkbox" type="checkbox" value="${symbol}" id="symbol-${symbol}" ${isAllChecked ? 'checked' : ''}>
                    <label class="form-check-label fw-bold" for="symbol-${symbol}">${symbol}</label>
                </div>
                <div class="ps-4">
                    ${symbolTxs.map(tx => `
                        <div class="form-check">
                            <input class="form-check-input transaction-checkbox" type="checkbox" value="${tx.id}" id="tx-${tx.id}" ${includedTxIds.has(tx.id) ? 'checked' : ''}>
                            <label class="form-check-label small" for="tx-${tx.id}">
                                ${tx.date.split('T')[0]} / ${tx.type} / ${tx.quantity} @ ${tx.price}
                            </label>
                        </div>`).join('')}
                </div>
            </div>`;
    }).join('');
}
