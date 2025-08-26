// =========================================================================================
// == 彈出視窗模組 (modals.js) v4.1 - Bug Fix
// =========================================================================================

import { getState, setState } from '../state.js';
import { stagingService } from '../staging.service.js';
import { isTwStock, formatNumber } from './utils.js';
import { renderDetailsModal } from './components/detailsModal.ui.js';
import { apiRequest, executeApiAction } from '../api.js';
import { loadGroups } from '../events/group.events.js';
import { showNotification } from './notifications.js';
import { renderTransactionsTable } from './components/transactions.ui.js';

// --- Helper Functions ---

function renderGroupAttributionContent(includedGroupIds = new Set()) {
    const { tempTransactionData, groups } = getState();
    if (!tempTransactionData) return;

    const symbol = tempTransactionData.data.symbol;
    document.getElementById('attribution-symbol-placeholder').textContent = symbol;

    const container = document.getElementById('attribution-groups-container');
    container.innerHTML = groups.length > 0
        ? groups.map(g => `
            <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                <input type="checkbox" name="attribution_group" value="${g.id}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${includedGroupIds.has(g.id) ? 'checked' : ''}>
                <span class="font-medium text-gray-700">${g.name}</span>
            </label>
        `).join('')
        : '<p class="text-center text-sm text-gray-500 py-4">尚未建立任何群組。</p>';

    const newGroupContainer = document.getElementById('attribution-new-group-container');
    newGroupContainer.innerHTML = `
        <div class="relative">
            <input type="text" id="new-group-name-input" placeholder="+ 建立新群組並加入" class="w-full pl-3 pr-10 py-2 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <button type="button" id="add-new-group-btn" class="absolute inset-y-0 right-0 px-3 flex items-center text-indigo-600 hover:text-indigo-800">建立</button>
        </div>
    `;

    document.getElementById('add-new-group-btn').addEventListener('click', () => {
        const input = document.getElementById('new-group-name-input');
        const newGroupName = input.value.trim();
        if (newGroupName && !groups.some(g => g.name === newGroupName)) {
            const tempId = `temp_${Date.now()}`;
            const newGroupCheckbox = `
                <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer bg-indigo-50">
                    <input type="checkbox" name="attribution_group" value="${tempId}" data-new-name="${newGroupName}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked>
                    <span class="font-medium text-indigo-700">${newGroupName} (新)</span>
                </label>
            `;
            container.insertAdjacentHTML('beforeend', newGroupCheckbox);
            input.value = '';
        }
    });
}

async function submitAttributionAndSaveTransaction() {
    const { tempTransactionData } = getState();
    if (!tempTransactionData) return;
    
    closeModal('group-attribution-modal');

    try {
        // 【核心修正】確保新增操作被正確標記
        const actionType = tempTransactionData.isEditing ? 'UPDATE' : 'CREATE';
        await stagingService.addAction(actionType, 'transaction', tempTransactionData.data);
        
        showNotification('info', '交易操作已暫存。');
        await renderTransactionsTable();

    } catch (error) {
        showNotification('error', `暫存交易失敗: ${error.message}`);
    } finally {
        setState({ tempTransactionData: null });
    }
}

async function handleMembershipSave() {
    const { tempMembershipEdit } = getState();
    if (!tempMembershipEdit) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="membership_group"]:checked')).map(cb => cb.value);

    closeModal('membership-editor-modal');
    
    // 這個操作直接修改關聯，維持直接API呼叫，因其不直接修改實體本身
    executeApiAction('update_transaction_group_membership', {
        transactionId: tempMembershipEdit.txId,
        groupIds: selectedGroupIds
    }, {
        loadingText: '正在更新群組歸屬...',
        successMessage: '群組歸屬已更新！',
        shouldRefreshData: false
    }).then(() => {
        loadGroups();
    }).catch(err => console.error("更新群組歸屬失敗:", err));
}

// --- Exported Functions ---

export async function openModal(modalId, isEdit = false, data = null) {
    const { stockNotes, pendingDividends, confirmedDividends, transactions, groups } = getState();
    const formId = modalId.replace('-modal', '-form');
    const form = document.getElementById(formId);
    if (form) form.reset();

    if (modalId === 'transaction-modal') {
        document.getElementById('transaction-id').value = '';
        const confirmBtn = document.getElementById('confirm-transaction-btn');
        
        if (isEdit && data) {
            document.getElementById('modal-title').textContent = '編輯交易紀錄';
            if(confirmBtn) confirmBtn.textContent = '儲存變更';
            
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
            document.getElementById('modal-title').textContent = '新增交易紀錄 (步驟 1/2)';
            if(confirmBtn) confirmBtn.textContent = '下一步';
            document.getElementById('transaction-date').value = new Date().toISOString().split('T')[0];
        }
        toggleOptionalFields();
    } else if (modalId === 'split-modal') {
        document.getElementById('split-date').value = new Date().toISOString().split('T')[0];
    } 
    else if (modalId === 'dividend-modal') {
        const record = isEdit
            ? confirmedDividends.find(d => d.id === data.id)
            : pendingDividends[data.index];
        if (!record) return;

        document.getElementById('dividend-modal-title').textContent = isEdit ? `編輯 ${record.symbol} 的配息` : `確認 ${record.symbol} 的配息`;
        document.getElementById('dividend-id').value = record.id || '';
        // ... (其他配息 modal 欄位設定)

    } else if (modalId === 'details-modal') {
        const { symbol } = data;
        if (symbol) {
            renderDetailsModal(symbol);
        }
    } else if (modalId === 'membership-editor-modal') {
        const { txId } = data;
        
        // 【核心修正】合併 state 和 staging area 的數據
        const stagedActions = await stagingService.getStagedActions();
        const stagedTransactions = stagedActions.filter(a => a.entity === 'transaction' && a.type !== 'DELETE').map(a => a.payload);
        const combinedTxs = [...transactions, ...stagedTransactions];
        const tx = combinedTxs.find(t => t.id === txId);
        
        if (!tx) {
            showNotification('error', '找不到指定的交易紀錄來編輯群組。');
            return;
        }
        
        setState({ tempMembershipEdit: { txId } });

        document.getElementById('membership-symbol-placeholder').textContent = tx.symbol;
        document.getElementById('membership-date-placeholder').textContent = tx.date.split('T')[0];
        
        const container = document.getElementById('membership-groups-container');
        container.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">正在讀取歸屬狀態...</p>';
        
        try {
            const result = await apiRequest('get_transaction_memberships', { transactionId: txId });
            const includedGroupIds = new Set(result.data.groupIds);

            container.innerHTML = groups.length > 0
                ? groups.map(g => `
                    <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                        <input type="checkbox" name="membership_group" value="${g.id}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${includedGroupIds.has(g.id) ? 'checked' : ''}>
                        <span class="font-medium text-gray-700">${g.name}</span>
                    </label>
                `).join('')
                : '<p class="text-center text-sm text-gray-500 py-4">尚未建立任何群組。</p>';

        } catch (error) {
            container.innerHTML = '<p class="text-center text-sm text-red-500 py-4">讀取歸屬狀態失敗。</p>';
            console.error("讀取交易歸屬失敗:", error);
        }
    }

    document.getElementById(modalId).classList.remove('hidden');
    if (modalId === 'membership-editor-modal') {
        document.getElementById('save-membership-btn').onclick = handleMembershipSave;
        document.getElementById('cancel-membership-btn').onclick = () => closeModal('membership-editor-modal');
    }
}

export async function openGroupAttributionModal() {
    const { tempTransactionData } = getState();
    if (!tempTransactionData) return;

    const modalTitle = document.getElementById('attribution-modal-title');
    modalTitle.textContent = tempTransactionData.isEditing 
        ? '編輯交易紀錄 (步驟 2/2)' 
        : '新增交易紀錄 (步驟 2/2)';

    let includedGroupIds = new Set();
    const container = document.getElementById('attribution-groups-container');
    container.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">正在讀取群組狀態...</p>';

    if (tempTransactionData.isEditing && tempTransactionData.txId) {
        try {
            const result = await apiRequest('get_transaction_memberships', { transactionId: tempTransactionData.txId });
            if (result.success) {
                includedGroupIds = new Set(result.data.groupIds);
            }
        } catch (error) {
            console.error("讀取交易歸屬失敗:", error);
            showNotification('error', '讀取現有群組歸屬失敗。');
        }
    }

    renderGroupAttributionContent(includedGroupIds);
    
    const modalElement = document.getElementById('group-attribution-modal');
    modalElement.classList.remove('hidden');
    document.getElementById('confirm-attribution-btn').onclick = submitAttributionAndSaveTransaction;
    document.getElementById('cancel-attribution-btn').onclick = () => closeModal('group-attribution-modal');
}


export function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

export function showConfirm(message, callback, title = '確認操作', cancelCallback = null) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    setState({ confirmCallback: callback });
    // 【核心修正】儲存取消回呼
    document.getElementById('confirm-cancel-btn').onclick = cancelCallback || (() => hideConfirm());
    document.getElementById('confirm-modal').classList.remove('hidden');
}

export function hideConfirm() {
    setState({ confirmCallback: null });
    // 還原預設的取消行為
    document.getElementById('confirm-cancel-btn').onclick = () => hideConfirm();
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

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    const attributionModal = document.getElementById('group-attribution-modal');
    if (!attributionModal.classList.contains('hidden')) {
        e.preventDefault();
        if (document.activeElement === document.getElementById('new-group-name-input')) {
            document.getElementById('add-new-group-btn').click();
        } else {
            document.getElementById('confirm-attribution-btn').click();
        }
        return;
    }

    const membershipModal = document.getElementById('membership-editor-modal');
    if (!membershipModal.classList.contains('hidden')) {
        e.preventDefault();
        document.getElementById('save-membership-btn').click();
        return;
    }
});
