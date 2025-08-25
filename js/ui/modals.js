// =========================================================================================
// == 彈出視窗模組 (modals.js) v3.7 - Cleanup Event Listeners
// =========================================================================================

import { getState, setState } from '../state.js';
import { isTwStock, formatNumber } from './utils.js';
import { renderDetailsModal } from './components/detailsModal.ui.js';
import { apiRequest } from '../api.js';
import { showNotification } from './notifications.js';
import { refreshAllStagedViews } from '../app.js';
import { renderGroupModal } from './components/groups.ui.js';


// --- Helper Functions ---

function renderGroupAttributionContent(includedGroupIds = new Set()) {
    // ... Omitted for brevity
}

async function submitAttributionAndSaveTransaction() {
    // ... Omitted for brevity
}

async function handleMembershipSave() {
    const { tempMembershipEdit } = getState();
    if (!tempMembershipEdit) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="membership_group"]:checked')).map(cb => cb.value);

    closeModal('membership-editor-modal');
    
    const change = {
        op: 'UPDATE',
        entity: 'group_membership',
        payload: { transactionId: tempMembershipEdit.txId, groupIds: selectedGroupIds }
    };
    
    try {
        await apiRequest('stage_change', change);
        showNotification('info', `群組歸屬變更已加入暫存區。`);
        await refreshAllStagedViews();
    } catch (error) {
        showNotification('error', `更新群組歸屬失敗: ${error.message}`);
    } finally {
        setState({ tempMembershipEdit: null });
    }
}


export async function openModal(modalId, isEdit = false, data = null) {
    const { stockNotes, pendingDividends, confirmedDividends, transactions, groups } = getState();
    const formId = modalId.replace('-modal', '-form';
    const form = document.getElementById(formId);
    if (form) form.reset();

    if (modalId === 'transaction-modal') {
        document.getElementById('transaction-id').value = '';
        const confirmBtn = document.getElementById('confirm-transaction-btn');
        const modalTitle = document.getElementById('modal-title');
        
        if (isEdit && data) {
            modalTitle.textContent = '編輯交易紀錄';
            confirmBtn.textContent = '儲存至暫存區';
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
            modalTitle.textContent = '新增交易紀錄 (步驟 1/2)';
            confirmBtn.textContent = '下一步';
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
        // ... Omitted for brevity ...
    } else if (modalId === 'details-modal') {
        const { symbol } = data;
        if (symbol) renderDetailsModal(symbol);
    } else if (modalId === 'membership-editor-modal') {
        const { txId } = data;
        const tx = transactions.find(t => t.id === txId);
        if (!tx) return;
        setState({ tempMembershipEdit: { txId } });
        document.getElementById('membership-symbol-placeholder').textContent = tx.symbol;
        document.getElementById('membership-date-placeholder').textContent = tx.date.split('T')[0];
        const container = document.getElementById('membership-groups-container');
        container.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">正在讀取歸屬狀態...</p>';
        try {
            const result = await apiRequest('get_transaction_memberships', { transactionId: txId });
            const includedGroupIds = new Set(result.data.groupIds);
            container.innerHTML = groups.length > 0
                ? groups.map(g => `<label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer"><input type="checkbox" name="membership_group" value="${g.id}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${includedGroupIds.has(g.id) ? 'checked' : ''}><span class="font-medium text-gray-700">${g.name}</span></label>`).join('')
                : '<p class="text-center text-sm text-gray-500 py-4">尚未建立任何群組。</p>';
        } catch (error) {
            container.innerHTML = '<p class="text-center text-sm text-red-500 py-4">讀取歸屬狀態失敗。</p>';
        }
    } else if (modalId === 'group-modal') {
        const { groupId } = data || {};
        if (isEdit && groupId) {
            const result = await apiRequest('get_group_details', { groupId });
            if (result.success) renderGroupModal(result.data);
        } else {
            renderGroupModal(null);
        }
    }

    document.getElementById(modalId).classList.remove('hidden');

    // ========================= 【核心修改 - 開始】 =========================
    // 移除此處的事件綁定，統一由 main.js 在頂層處理
    if (modalId === 'membership-editor-modal') {
        document.getElementById('save-membership-btn').onclick = handleMembershipSave;
        // cancel-membership-btn 的事件已由 main.js 處理
    }
    // ========================= 【核心修改 - 結束】 =========================
}

export function openGroupAttributionModal() {
    // ... Omitted for brevity
}

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
    }
}

export function showConfirm(message, callback, title = '確認操作') {
    // ... Omitted for brevity
}

export function hideConfirm() {
    // ... Omitted for brevity
}

export function toggleOptionalFields() {
    // ... Omitted for brevity
}

document.addEventListener('keydown', (e) => {
    // ... Omitted for brevity
});
