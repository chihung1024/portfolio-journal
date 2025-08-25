// =========================================================================================
// == 彈出視窗模組 (modals.js) v3.5 - Centralized Refresh
// =========================================================================================

import { getState, setState } from '../state.js';
import { isTwStock, formatNumber } from './utils.js';
import { renderDetailsModal } from './components/detailsModal.ui.js';
import { apiRequest } from '../api.js';
import { showNotification } from './notifications.js';

// ========================= 【核心修改 - 開始】 =========================
import { refreshAllStagedViews } from '../app.js';
// ========================= 【核心修改 - 結束】 =========================


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

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="attribution_group"]:checked')).map(cb => cb.value);
    const newGroups = Array.from(document.querySelectorAll('input[name="attribution_group"][data-new-name]:checked')).map(cb => ({ tempId: cb.value, name: cb.dataset.newName }));

    const finalPayload = { ...tempTransactionData.data, groupInclusions: selectedGroupIds, newGroups: newGroups };
    
    closeModal('group-attribution-modal');
    
    const change = { op: 'CREATE', entity: 'transaction', payload: finalPayload };

    try {
        await apiRequest('stage_change', change);
        showNotification('info', `交易已加入暫存區。`);
        await refreshAllStagedViews();
    } catch (error) {
        showNotification('error', `操作失敗: ${error.message}`);
    } finally {
        setState({ tempTransactionData: null });
    }
}

/**
 * 為微觀編輯視窗儲存變更 (此處邏輯改為送入暫存區)
 */
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
    
    // ========================= 【核心修改 - 開始】 =========================
    try {
        await apiRequest('stage_change', change);
        showNotification('info', `群組歸屬變更已加入暫存區。`);
        await refreshAllStagedViews(); // <--- 使用全局刷新
    } catch (error) {
        showNotification('error', `更新群組歸屬失敗: ${error.message}`);
    } finally {
        setState({ tempMembershipEdit: null });
    }
    // ========================= 【核心修改 - 結束】 =========================
}


export async function openModal(modalId, isEdit = false, data = null) {
    const { stockNotes, pendingDividends, confirmedDividends, transactions, groups } = getState();
    const formId = modalId.replace('-modal', '-form');
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
                ? groups.map(g => `
                    <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                        <input type="checkbox" name="membership_group" value="${g.id}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${includedGroupIds.has(g.id) ? 'checked' : ''}>
                        <span class="font-medium text-gray-700">${g.name}</span>
                    </label>
                `).join('')
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
    if (modalId === 'membership-editor-modal') {
        document.getElementById('save-membership-btn').onclick = handleMembershipSave;
        document.getElementById('cancel-membership-btn').onclick = () => closeModal('membership-editor-modal');
    }
}

export async function openGroupAttributionModal() { /* ... Omitted for brevity ... */ }
export function closeModal(modalId) { /* ... Omitted for brevity ... */ }
export function showConfirm(message, callback, title = '確認操作') { /* ... Omitted for brevity ... */ }
export function hideConfirm() { /* ... Omitted for brevity ... */ }
export function toggleOptionalFields() { /* ... Omitted for brevity ... */ }

document.addEventListener('keydown', (e) => { /* ... Omitted for brevity ... */ });
