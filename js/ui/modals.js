// ='========================================================================================
// == 彈出視窗模組 (modals.js) v4.0 - 整合暫存區
// =========================================================================================

import { getState, setState } from '../state.js';
import { stagingService } from '../staging.service.js'; // 【核心修改】
import { isTwStock, formatNumber } from './utils.js';
import { renderDetailsModal } from './components/detailsModal.ui.js';
import { apiRequest } from '../api.js';
import { loadGroups } from '../events/group.events.js';
import { showNotification } from './notifications.js'; // 【核心修改】
import { renderTransactionsTable } from './components/transactions.ui.js'; // 【核心修改】


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

/**
 * 【核心修改】提交歸因選擇並將交易存入暫存區
 */
async function submitAttributionAndSaveTransaction() {
    const { tempTransactionData } = getState();
    if (!tempTransactionData) return;

    // 注意：群組歸屬的邏輯將在後端批次處理時完成，前端暫存時只需記錄交易本身。
    // 更進階的作法是可以將群組歸屬也作為一個暫存操作。為了簡化，我們先只暫存交易。
    
    closeModal('group-attribution-modal');

    try {
        const actionType = tempTransactionData.isEditing ? 'UPDATE' : 'CREATE';
        await stagingService.addAction(actionType, 'transaction', tempTransactionData.data);
        
        showNotification('info', '交易操作已暫存。');
        renderTransactionsTable(); // 立即刷新列表以顯示暫存狀態

    } catch (error) {
        showNotification('error', `暫存交易失敗: ${error.message}`);
    } finally {
        setState({ tempTransactionData: null }); // 清空臨時數據
    }
}

async function handleMembershipSave() {
    const { tempMembershipEdit } = getState();
    if (!tempMembershipEdit) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="membership_group"]:checked')).map(cb => cb.value);

    closeModal('membership-editor-modal');
    
    // 注意：這個操作比較特殊，它直接修改關聯表，我們將其視為對群組的更新
    // 為了簡化，此處維持直接呼叫 API
    const { executeApiAction } = await import('../api.js');
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
    const { pendingDividends, confirmedDividends, transactions, groups } = getState();
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
    // 【核心修改】移除 notes-modal 的處理邏輯
    else if (modalId === 'dividend-modal') {
        const record = isEdit
            ? confirmedDividends.find(d => d.id === data.id)
            : pendingDividends[data.index];
        if (!record) return;

        document.getElementById('dividend-modal-title').textContent = isEdit ? `編輯 ${record.symbol} 的配息` : `確認 ${record.symbol} 的配息`;
        document.getElementById('dividend-id').value = record.id || '';
        document.getElementById('dividend-symbol').value = record.symbol;
        // ... (其他配息 modal 欄位設定)
    } else if (modalId === 'details-modal') {
        const { symbol } = data;
        if (symbol) {
            renderDetailsModal(symbol);
        }
    } else if (modalId === 'membership-editor-modal') {
        const { txId } = data;
        const tx = transactions.find(t => t.id === txId);
        if (!tx) return;
        
        setState({ tempMembershipEdit: { txId } });
        // ... (其他 membership modal 欄位設定)
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

export function showConfirm(message, callback, title = '確認操作') {
    document.getElementById('confirm-title').textContent = title;
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