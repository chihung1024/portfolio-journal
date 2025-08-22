// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.1.0 - 修正新增流程 & 支援暫存區編輯
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { openModal, closeModal, showConfirm, openGroupAttributionModal } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { updateStagingBanner } from '../ui/components/stagingBanner.ui.js';
import { v4 as uuidv4 } from 'https://jspm.dev/uuid';


// --- Private Functions (內部函式) ---

/**
 * 【重構】處理新增或編輯交易表單的提交
 */
async function handleTransactionFormSubmit() {
    const txId = document.getElementById('transaction-id').value;
    const isEditing = !!txId;

    const transactionData = {
        date: document.getElementById('transaction-date').value,
        symbol: document.getElementById('stock-symbol').value.toUpperCase().trim(),
        type: document.querySelector('input[name="transaction-type"]:checked').value,
        quantity: parseFloat(document.getElementById('quantity').value),
        price: parseFloat(document.getElementById('price').value),
        currency: document.getElementById('currency').value,
        totalCost: parseFloat(document.getElementById('total-cost').value) || null,
        exchangeRate: parseFloat(document.getElementById('exchange-rate').value) || null
    };

    if (!transactionData.symbol || isNaN(transactionData.quantity) || isNaN(transactionData.price)) {
        showNotification('error', '請填寫所有必填欄位。');
        return;
    }
    
    closeModal('transaction-modal');

    // 【核心修正】根據是「新增」還是「編輯」來決定流程
    if (isEditing) {
        // 如果是編輯，直接進入暫存流程
        stageTransactionChange('UPDATE', transactionData, txId);
    } else {
        // 如果是新增，先暫存交易數據，然後開啟群組選擇視窗
        setState({ 
            tempTransactionData: {
                isEditing: false,
                txId: uuidv4(), // 為新交易預先生成 ID
                data: transactionData
            }
        });
        // 短暫延遲以確保 modal 動畫完成
        setTimeout(() => openGroupAttributionModal(), 150);
    }
}

/**
 * 【新增】將交易變更加入暫存區的統一函式
 * @param {'CREATE' | 'UPDATE'} op - 操作類型
 * @param {object} payload - 交易數據
 * @param {string} entityId - 交易的唯一 ID
 */
function stageTransactionChange(op, payload, entityId) {
    const currentState = getState();
    let updatedTransactions;
    
    const finalPayload = (op === 'UPDATE') ? { ...payload, id: entityId } : payload;

    // 步驟 1: 樂觀更新 UI
    if (op === 'UPDATE') {
        updatedTransactions = currentState.transactions.map(t => 
            t.id === entityId ? { ...t, ...finalPayload, status: 'STAGED_UPDATE' } : t
        );
    } else { // CREATE
        const newTransaction = { ...finalPayload, id: entityId, status: 'STAGED_CREATE' };
        updatedTransactions = [newTransaction, ...currentState.transactions];
    }

    const change = { id: entityId, op, entity: 'transaction', payload: finalPayload };
    
    // 智能合併變更：如果已存在對同一個項目的變更，則更新它，否則新增
    const otherChanges = currentState.stagedChanges.filter(c => c.id !== entityId);

    setState({
        transactions: updatedTransactions,
        stagedChanges: [...otherChanges, change],
        hasStagedChanges: true
    });

    renderTransactionsTable();
    updateStagingBanner();

    // 步驟 2: 背景發送暫存請求
    apiRequest('stage_change', { op, entity: 'transaction', payload: finalPayload })
        .then(() => {
            showNotification('info', `一筆交易變更已加入待辦，請記得提交。`);
        })
        .catch(error => {
            showNotification('error', `暫存變更失敗: ${error.message}，正在還原 UI...`);
            setState({
                transactions: currentState.transactions,
                stagedChanges: currentState.stagedChanges,
                hasStagedChanges: currentState.stagedChanges.length > 0
            });
            renderTransactionsTable();
            updateStagingBanner();
        });
}


/**
 * 處理刪除交易按鈕 (邏輯不變)
 */
async function handleDelete(button) {
    const txId = button.dataset.id;
    const { transactions } = getState();
    const transactionToDelete = transactions.find(t => t.id === txId);
    if (!transactionToDelete) return;

    showConfirm('確定要刪除這筆交易紀錄嗎？此操作將加入待辦清單。', () => {
        const currentState = getState();
        const updatedTransactions = currentState.transactions.map(t => 
            t.id === txId ? { ...t, status: 'STAGED_DELETE' } : t
        );
        
        const change = { id: txId, op: 'DELETE', entity: 'transaction', payload: { id: txId } };
        const otherChanges = currentState.stagedChanges.filter(c => c.id !== txId);

        setState({
            transactions: updatedTransactions,
            stagedChanges: [...otherChanges, change],
            hasStagedChanges: true
        });

        renderTransactionsTable();
        updateStagingBanner();

        apiRequest('stage_change', { op: 'DELETE', entity: 'transaction', payload: { id: txId } })
            .then(() => showNotification('info', '一筆刪除操作已加入待辦，請記得提交。'))
            .catch(error => {
                showNotification('error', `暫存刪除操作失敗: ${error.message}，正在還原 UI...`);
                setState({
                    transactions: currentState.transactions,
                    stagedChanges: currentState.stagedChanges,
                    hasStagedChanges: currentState.stagedChanges.length > 0
                });
                renderTransactionsTable();
                updateStagingBanner();
            });
    });
}

/**
 * 處理還原暫存變更 (邏輯不變)
 */
async function handleRevertChange(button) {
    const changeId = button.dataset.changeId;
    // ... (此處邏輯維持不變)
    const currentState = getState();
    const updatedStagedChanges = currentState.stagedChanges.filter(c => c.id !== changeId);
    setState({
        stagedChanges: updatedStagedChanges,
        hasStagedChanges: updatedStagedChanges.length > 0
    });
    try {
        await apiRequest('revert_staged_change', { changeId });
        showNotification('success', '變更已成功還原。');
        const result = await apiRequest('get_transactions_with_staging', {});
        setState({ transactions: result.data.transactions });
        renderTransactionsTable();
        updateStagingBanner();
    } catch (error) {
        showNotification('error', `還原失敗: ${error.message}`);
        setState({
            stagedChanges: currentState.stagedChanges,
            hasStagedChanges: currentState.hasStagedChanges,
        });
    }
}


// --- Public Function (公開函式，由 main.js 呼叫) ---

export function initializeTransactionEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', () => {
        setState({ tempTransactionData: null }); // 清空舊的暫存
        openModal('transaction-modal');
    });

    document.getElementById('confirm-transaction-btn').addEventListener('click', handleTransactionFormSubmit);
    
    document.getElementById('cancel-transaction-btn').addEventListener('click', () => {
        closeModal('transaction-modal');
    });

    document.getElementById('transactions-tab').addEventListener('click', (e) => {
        const editButton = e.target.closest('.edit-btn');
        if (editButton) {
            e.preventDefault();
            const txId = editButton.dataset.id;
            const transaction = getState().transactions.find(t => t.id === txId);
            if (transaction) {
                // 對於暫存的 CREATE，其 ID 可能不是 UUID，但仍可編輯
                openModal('transaction-modal', true, transaction);
            }
            return;
        }

        const deleteButton = e.target.closest('.delete-btn');
        if (deleteButton) {
            e.preventDefault();
            handleDelete(deleteButton);
            return;
        }
        
        const membershipButton = e.target.closest('.edit-membership-btn');
        if (membershipButton) {
            e.preventDefault();
            const txId = membershipButton.dataset.id;
            openModal('membership-editor-modal', false, { txId });
            return;
        }

        const revertButton = e.target.closest('.revert-change-btn');
        if (revertButton) {
            e.preventDefault();
            handleRevertChange(revertButton);
            return;
        }

        const pageButton = e.target.closest('.page-btn');
        if (pageButton) {
            e.preventDefault();
            const newPage = parseInt(pageButton.dataset.page, 10);
            if (!isNaN(newPage) && newPage > 0) {
                setState({ transactionsCurrentPage: newPage });
                renderTransactionsTable(); 
            }
            return;
        }
    });

    document.getElementById('transactions-tab').addEventListener('change', (e) => {
        if (e.target.id === 'transaction-symbol-filter') {
            setState({ 
                transactionFilter: e.target.value,
                transactionsCurrentPage: 1 
            });
            renderTransactionsTable();
        }
    });
}

// 【新增】導出此函式，供 modals.js 呼叫
export { stageTransactionChange };
