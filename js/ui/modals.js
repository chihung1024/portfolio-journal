// =========================================================================================
// == 彈出視窗模組 (modals.js) v3.2 - 修復編輯歸屬流程
// =========================================================================================

import { getState, setState } from '../state.js';
import { isTwStock, formatNumber } from './utils.js';
import { renderDetailsModal } from './components/detailsModal.ui.js';
import { apiRequest, executeApiAction } from '../api.js';
import { loadGroups } from '../events/group.events.js';


// --- Helper Functions ---

/**
 * 【核心修改】渲染群組歸屬嚮導視窗的內容，並根據傳入的 ID 預先勾選
 * @param {Set<string>} includedGroupIds - 一個包含該交易已有所屬的群組 ID 的 Set
 */
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
 * 提交歸因選擇並儲存交易
 */
async function submitAttributionAndSaveTransaction() {
    const { tempTransactionData } = getState();
    if (!tempTransactionData) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="attribution_group"]:checked'))
                                  .map(cb => cb.value);

    const newGroups = Array.from(document.querySelectorAll('input[name="attribution_group"][data-new-name]:checked'))
                           .map(cb => ({ tempId: cb.value, name: cb.dataset.newName }));

    const finalPayload = {
        transactionData: tempTransactionData.data,
        groupInclusions: selectedGroupIds,
        newGroups: newGroups,
    };
    
    closeModal('group-attribution-modal');

    const action = tempTransactionData.isEditing ? 'edit_transaction' : 'add_transaction';
    const payloadForApi = tempTransactionData.isEditing 
        ? { txId: tempTransactionData.txId, txData: finalPayload.transactionData, groupInclusions: finalPayload.groupInclusions, newGroups: finalPayload.newGroups }
        : finalPayload;
    const successMessage = tempTransactionData.isEditing ? '交易已成功更新！' : '交易已成功新增！';

    executeApiAction(action, payloadForApi, {
        loadingText: '正在儲存交易與群組設定...',
        successMessage: successMessage,
        shouldRefreshData: true
    }).catch(error => {
        console.error("儲存交易最終失敗:", error);
    });
}

/**
 * 為微觀編輯視窗儲存變更，並在成功後刷新
 */
async function handleMembershipSave() {
    const { tempMembershipEdit } = getState();
    if (!tempMembershipEdit) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="membership_group"]:checked')).map(cb => cb.value);

    closeModal('membership-editor-modal');
    
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

/**
 * 【核心修改】重寫此函式，使其能夠處理編輯模式
 */
export async function openGroupAttributionModal() {
    const { tempTransactionData } = getState();
    if (!tempTransactionData) return;

    // 步驟 1: 動態設定標題
    const modalTitle = document.getElementById('attribution-modal-title');
    modalTitle.textContent = tempTransactionData.isEditing 
        ? '編輯交易紀錄 (步驟 2/2)' 
        : '新增交易紀錄 (步驟 2/2)';

    let includedGroupIds = new Set();
    const container = document.getElementById('attribution-groups-container');
    container.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">正在讀取群組狀態...</p>';

    // 步驟 2: 如果是編輯模式，異步獲取該交易的群組歸屬
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

    // 步驟 3: 使用獲取到的 (或空的) 群組 ID 集合來渲染內容
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
