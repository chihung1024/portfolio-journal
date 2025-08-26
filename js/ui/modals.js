// =========================================================================================
// == 彈出視窗模組 (modals.js) v4.1.0 - 整合操作隊列 (最終修正)
// =========================================================================================

import { getState, setState } from '../state.js';
import { isTwStock, formatNumber } from './utils.js';
import { renderDetailsModal } from './components/detailsModal.ui.js';
import { apiRequest } from '../api.js';
import { loadGroups } from '../events/group.events.js';
import { addToQueue } from '../op_queue_manager.js';
import { showNotification } from '../ui/notifications.js';


// --- Helper Functions ---

/**
 * 【已廢棄】渲染群組歸屬嚮導視窗的內容
 */
function renderGroupAttributionContent(includedGroupIds = new Set()) {
    // This function is deprecated as the two-step transaction add is removed.
}

/**
 * 【已廢棄】提交歸因選擇並儲存交易
 */
async function submitAttributionAndSaveTransaction() {
    console.warn("DEPRECATED: submitAttributionAndSaveTransaction in modals.js was called.");
}

/**
 * 為微觀編輯視窗儲存變更，改為加入操作隊列
 */
async function handleMembershipSave() {
    const { tempMembershipEdit } = getState();
    if (!tempMembershipEdit) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="membership_group"]:checked')).map(cb => cb.value);

    closeModal('membership-editor-modal');
    
    // 將操作加入隊列，而不是直接發送 API
    const success = addToQueue('UPDATE', 'transaction_group_membership', {
        transactionId: tempMembershipEdit.txId,
        groupIds: selectedGroupIds
    });
    
    if (success) {
        showNotification('info', '群組歸屬變更已暫存。');
    }
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
            if(confirmBtn) confirmBtn.textContent = '暫存變更';
            
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
            if(confirmBtn) confirmBtn.textContent = '加入暫存';
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
    console.warn("DEPRECATED: openGroupAttributionModal was called, but this flow is obsolete.");
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

    const membershipModal = document.getElementById('membership-editor-modal');
    if (membershipModal && !membershipModal.classList.contains('hidden')) {
        e.preventDefault();
        document.getElementById('save-membership-btn').click();
        return;
    }
});
