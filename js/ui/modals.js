// =========================================================================================
// == 彈出視窗模組 (modals.js) v4.0.0 - (核心重構) 支援 ATLAS-COMMIT 新增流程
// =========================================================================================

import { getState, setState } from '../state.js';
import { isTwStock, formatNumber } from './utils.js';
import { renderDetailsModal } from './components/detailsModal.ui.js';
import { apiRequest } from '../api.js';
import { loadGroups } from '../events/group.events.js';
// 【新增】從 transaction.events.js 導入 stageTransactionChange 函式
import { stageTransactionChange } from '../events/transaction.events.js';
import { updateStagingBanner } from './components/stagingBanner.ui.js';


// --- Helper Functions ---

/**
 * 【重構】提交歸因選擇並將「交易」與「群組歸屬」一併存入暫存區
 */
async function submitAttributionAndSaveTransaction() {
    const { tempTransactionData } = getState();
    if (!tempTransactionData || tempTransactionData.isEditing) return;

    // 步驟 1: 暫存「新增交易」本身的操作
    stageTransactionChange('CREATE', tempTransactionData.data, tempTransactionData.txId);

    // 步驟 2: 檢查是否有群組歸屬變更，如果有，也將其加入暫存區
    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="attribution_group"]:checked'))
                                  .map(cb => cb.value);
    
    // 注意：在新架構下，我們不再處理 "newGroups" 的臨時創建，這應該是一個獨立的群組管理操作。
    // 這簡化了流程，確保單次交易的原子性。

    if (selectedGroupIds.length > 0) {
        const payload = {
            transactionId: tempTransactionData.txId,
            groupIds: selectedGroupIds.filter(id => !id.startsWith('temp_')) // 過濾掉臨時ID
        };
        const op = 'UPDATE';
        const entity = 'group_membership';
        
        // 樂觀更新
        const currentState = getState();
        const change = { id: payload.transactionId, op, entity, payload };
        const otherChanges = currentState.stagedChanges.filter(c => !(c.entity === 'group_membership' && c.payload.transactionId === payload.transactionId));
        setState({
            stagedChanges: [...otherChanges, change],
            hasStagedChanges: true
        });
        updateStagingBanner();
        
        // 背景暫存
        apiRequest('stage_change', { op, entity, payload })
            .catch(error => showNotification('error', `暫存群組歸屬失敗: ${error.message}`));
    }

    closeModal('group-attribution-modal');
    setState({ tempTransactionData: null }); // 清空臨時數據
}


/**
 * 處理微觀編輯視窗中的儲存按鈕 (邏輯不變)
 */
async function handleMembershipSave() {
    const { tempMembershipEdit } = getState();
    if (!tempMembershipEdit) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="membership_group"]:checked')).map(cb => cb.value);
    
    closeModal('membership-editor-modal');
    
    // ... (此處邏輯已在 group.events.js 中實現，維持不變)
    const payload = { transactionId: tempMembershipEdit.txId, groupIds: selectedGroupIds };
    const op = 'UPDATE';
    const entity = 'group_membership';
    const currentState = getState();
    const change = { id: payload.transactionId, op, entity, payload };
    const otherChanges = currentState.stagedChanges.filter(c => !(c.entity === 'group_membership' && c.payload.transactionId === payload.transactionId));
    setState({ stagedChanges: [...otherChanges, change], hasStagedChanges: true });
    updateStagingBanner();
    apiRequest('stage_change', { op, entity, payload })
        .then(() => showNotification('info', '一筆群組歸屬變更已加入待辦。'))
        .catch(error => showNotification('error', `暫存歸屬變更失敗: ${error.message}`));
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
        const modalTitle = document.getElementById('modal-title');
        
        if (isEdit && data) {
            modalTitle.textContent = '編輯交易紀錄';
            confirmBtn.textContent = '儲存變更';
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
            // 注意：這裡應該讀取樂觀更新後的狀態，或直接從後端獲取最新狀態
            // 暫時維持直接API請求，以確保準確性
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
    } 
    // ... 其他 modal 的 open 邏輯維持不變 ...
    else if (modalId === 'split-modal') { document.getElementById('split-date').value = new Date().toISOString().split('T')[0]; }
    else if (modalId === 'notes-modal') { const note = stockNotes[data.symbol] || {}; document.getElementById('notes-modal-title').textContent = `編輯 ${data.symbol} 的筆記與目標`; document.getElementById('notes-symbol').value = data.symbol; document.getElementById('target-price').value = note.target_price || ''; document.getElementById('stop-loss-price').value = note.stop_loss_price || ''; document.getElementById('notes-content').value = note.notes || ''; }
    else if (modalId === 'dividend-modal') { const record = isEdit ? confirmedDividends.find(d => d.id === data.id) : pendingDividends[data.index]; if (!record) return; document.getElementById('dividend-modal-title').textContent = isEdit ? `編輯 ${record.symbol} 的配息` : `確認 ${record.symbol} 的配息`; document.getElementById('dividend-id').value = record.id || ''; /* ... and so on */ }
    else if (modalId === 'details-modal') { if (data.symbol) { renderDetailsModal(data.symbol); } }

    document.getElementById(modalId).classList.remove('hidden');
    if (modalId === 'membership-editor-modal') {
        document.getElementById('save-membership-btn').onclick = handleMembershipSave;
        document.getElementById('cancel-membership-btn').onclick = () => closeModal('membership-editor-modal');
    }
}

/**
 * 【重構】開啟群組歸屬嚮導視窗
 */
export function openGroupAttributionModal() {
    const { tempTransactionData, groups } = getState();
    if (!tempTransactionData) return;

    document.getElementById('attribution-symbol-placeholder').textContent = tempTransactionData.data.symbol;

    const container = document.getElementById('attribution-groups-container');
    container.innerHTML = groups.length > 0
        ? groups.map(g => `
            <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                <input type="checkbox" name="attribution_group" value="${g.id}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="font-medium text-gray-700">${g.name}</span>
            </label>
        `).join('')
        : '<p class="text-center text-sm text-gray-500 py-4">尚未建立任何群組。</p>';
    
    // 移除 "建立新群組" 的UI，簡化流程
    document.getElementById('attribution-new-group-container').innerHTML = '';

    const modalElement = document.getElementById('group-attribution-modal');
    modalElement.classList.remove('hidden');
    document.getElementById('confirm-attribution-btn').onclick = submitAttributionAndSaveTransaction;
    document.getElementById('cancel-attribution-btn').onclick = () => {
        // 如果取消第二步，依然要將第一步的交易加入暫存區
        submitAttributionAndSaveTransaction();
        closeModal('group-attribution-modal');
    };
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
