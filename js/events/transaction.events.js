// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.1.0 - (修正) 導出還原函式
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { updateStagingBanner } from '../ui/components/stagingBanner.ui.js';
import { v4 as uuidv4 } from 'https://jspm.dev/uuid';


// --- Private Functions (內部函式) ---

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

    const op = isEditing ? 'UPDATE' : 'CREATE';
    const entityId = isEditing ? txId : uuidv4(); 
    const payload = isEditing ? { ...transactionData, id: entityId } : transactionData;

    const currentState = getState();
    let updatedTransactions;

    if (isEditing) {
        updatedTransactions = currentState.transactions.map(t => {
            if (t.id === entityId) {
                return { ...t, ...payload, status: 'STAGED_UPDATE' };
            }
            return t;
        });
    } else {
        const newTransaction = {
            ...payload,
            id: entityId,
            status: 'STAGED_CREATE'
        };
        updatedTransactions = [newTransaction, ...currentState.transactions];
    }

    const change = { id: entityId, op, entity: 'transaction', payload };
    const otherChanges = currentState.stagedChanges.filter(c => c.id !== entityId);

    setState({
        transactions: updatedTransactions,
        stagedChanges: [...otherChanges, change],
        hasStagedChanges: true
    });

    renderTransactionsTable();
    updateStagingBanner();

    try {
        await apiRequest('stage_change', { op, entity: 'transaction', payload });
        showNotification('info', `一筆交易變更已加入待辦，請記得提交。`);
    } catch (error) {
        showNotification('error', `暫存變更失敗: ${error.message}，正在還原 UI...`);
        setState({
            transactions: currentState.transactions,
            stagedChanges: currentState.stagedChanges,
            hasStagedChanges: currentState.stagedChanges.length > 0
        });
        renderTransactionsTable();
        updateStagingBanner();
    }
}

async function handleDelete(button) {
    const txId = button.dataset.id;
    const { transactions } = getState();
    const transactionToDelete = transactions.find(t => t.id === txId);
    if (!transactionToDelete) return;

    showConfirm('確定要刪除這筆交易紀錄嗎？此操作將加入待辦清單。', () => {
        const currentState = getState();
        let updatedTransactions = currentState.transactions.map(t => {
            if (t.id === txId) {
                if (t.status === 'STAGED_CREATE') return null;
                return { ...t, status: 'STAGED_DELETE' };
            }
            return t;
        }).filter(Boolean);
        
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
            .then(() => {
                showNotification('info', '一筆刪除操作已加入待辦，請記得提交。');
            })
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
 * 【修改】處理還原暫存變更，並將其導出
 */
export async function handleRevertChange(button) {
    const changeId = button.dataset.changeId;
    const currentState = getState();

    // 先從 UI 上移除，提供即時反饋（雖然最終會被後端資料覆蓋）
    const updatedStagedChanges = currentState.stagedChanges.filter(c => c.id !== changeId);
    setState({
        stagedChanges: updatedStagedChanges,
        hasStagedChanges: updatedStagedChanges.length > 0
    });
    
    try {
        await apiRequest('revert_staged_change', { changeId });
        showNotification('success', '變更已成功還原。');
        
        // 從後端重新獲取權威的交易列表
        const result = await apiRequest('get_transactions_with_staging', {});
        
        // 更新 state 並重繪
        setState({ 
            transactions: result.data.transactions || [],
            hasStagedChanges: result.data.hasStagedChanges,
        });

        renderTransactionsTable();
        updateStagingBanner();

    } catch (error) {
        showNotification('error', `還原失敗: ${error.message}`);
        // 如果失敗，還原 state
        setState({
            stagedChanges: currentState.stagedChanges,
            hasStagedChanges: currentState.hasStagedChanges,
        });
        renderTransactionsTable();
        updateStagingBanner();
    }
}

// --- Public Function (公開函式，由 main.js 呼叫) ---

export function initializeTransactionEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', () => {
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
