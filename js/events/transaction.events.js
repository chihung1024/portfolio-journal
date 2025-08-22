// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.2.0 - (修正) 原子化樂觀更新
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
    // The transaction's own ID. This stays the same.
    const entityId = isEditing ? txId : uuidv4(); 
    const payload = { ...transactionData, id: entityId };

    // --- 【核心修正：先呼叫 API，再更新 UI】 ---
    try {
        // 1. 先將變更送到後端，並取得後端為此「事件」產生的唯一 ID
        const result = await apiRequest('stage_change', { op, entity: 'transaction', payload });
        const uniqueChangeId = result.changeId; // <--- 這就是關鍵的 ID

        // 2. 成功後，才用這個 uniqueChangeId 更新前端的 UI 狀態
        const currentState = getState();
        let updatedTransactions;

        if (isEditing) {
            updatedTransactions = currentState.transactions.map(t => {
                if (t.id === entityId) {
                    // 將 uniqueChangeId 附加到 transaction 物件上，供 UI 渲染「還原」按鈕使用
                    return { ...t, ...payload, status: 'STAGED_UPDATE', changeId: uniqueChangeId };
                }
                return t;
            });
        } else {
            const newTransaction = {
                ...payload,
                id: entityId,
                status: 'STAGED_CREATE',
                changeId: uniqueChangeId // 同樣附加 ID
            };
            updatedTransactions = [newTransaction, ...currentState.transactions];
        }
        
        // 建立 change 物件時，它的 id 就是後端回傳的 uniqueChangeId
        const change = { id: uniqueChangeId, op, entity: 'transaction', payload };
        
        // 篩選掉舊的、針對同一個 transaction 的變更 (如果有)
        const otherChanges = currentState.stagedChanges.filter(c => c.payload.id !== entityId);

        setState({
            transactions: updatedTransactions,
            stagedChanges: [...otherChanges, change],
            hasStagedChanges: true
        });

        renderTransactionsTable();
        updateStagingBanner();

        showNotification('info', `一筆交易變更已加入待辦，請記得提交。`);

    } catch (error) {
        showNotification('error', `暫存變更失敗: ${error.message}，正在還原 UI...`);
        // 因為 API 呼叫失敗時，我們根本還沒更新 UI，所以還原邏輯可以簡化或移除
        // 這裡保留是為了安全起見
        const currentState = getState();
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

    showConfirm('確定要刪除這筆交易紀錄嗎？此操作將加入待辦清單。', async () => {
        // --- 【核心修正：同樣改為先呼叫 API】 ---
        const op = 'DELETE';
        const entity = 'transaction';
        const payload = { id: txId };

        try {
            // 1. 先送出請求
            const result = await apiRequest('stage_change', { op, entity, payload });
            const uniqueChangeId = result.changeId;

            // 2. 成功後再更新 UI
            const currentState = getState();
            let updatedTransactions = currentState.transactions.map(t => {
                if (t.id === txId) {
                    if (t.status === 'STAGED_CREATE') return null; // 如果是還沒提交的新增，直接移除
                    // 附加 uniqueChangeId
                    return { ...t, status: 'STAGED_DELETE', changeId: uniqueChangeId };
                }
                return t;
            }).filter(Boolean);
            
            const change = { id: uniqueChangeId, op, entity, payload };
            const otherChanges = currentState.stagedChanges.filter(c => c.payload.id !== txId);

            setState({
                transactions: updatedTransactions,
                stagedChanges: [...otherChanges, change],
                hasStagedChanges: true
            });

            renderTransactionsTable();
            updateStagingBanner();
            showNotification('info', '一筆刪除操作已加入待辦，請記得提交。');

        } catch (error) {
            showNotification('error', `暫存刪除操作失敗: ${error.message}，正在還原 UI...`);
            const currentState = getState();
            setState({
                transactions: currentState.transactions,
                stagedChanges: currentState.stagedChanges,
                hasStagedChanges: currentState.stagedChanges.length > 0
            });
            renderTransactionsTable();
            updateStagingBanner();
        }
    });
}

/**
 * 【核心修改】處理還原暫存變更，採用原子化的樂觀更新
 */
export async function handleRevertChange(button) {
    // 這個 button 的 data-change-id 現在會是正確的 uniqueChangeId
    const changeId = button.dataset.changeId; 
    const currentState = getState();
    
    // --- 開始：原子化的樂觀更新 (這部分邏輯是正確的，不需要改) ---
    const changeToRevert = currentState.stagedChanges.find(c => c.id === changeId);
    if (!changeToRevert) {
        console.warn(`找不到要還原的變更: ${changeId}`);
        return;
    }

    let updatedTransactions;
    const entityIdToRevert = changeToRevert.payload.id;

    if (changeToRevert.op === 'CREATE') {
        updatedTransactions = currentState.transactions.filter(t => t.id !== entityIdToRevert);
    } else {
        // 找出原始狀態 (如果存在的話)
        const originalTx = await apiRequest('get_symbol_details', { symbol: changeToRevert.payload.symbol })
            .then(res => res.success ? res.data.transactions.find(t => t.id === entityIdToRevert) : null);

        if (changeToRevert.op === 'DELETE' && originalTx) {
             updatedTransactions = currentState.transactions.map(t => t.id === entityIdToRevert ? originalTx : t);
        } else {
            updatedTransactions = currentState.transactions.map(t => {
                if (t.id === entityIdToRevert) {
                    const { status, changeId, ...rest } = t; // 移除暫存狀態
                    // 如果能找到原始版本，就還原成原始版本
                    return originalTx || rest; 
                }
                return t;
            });
        }
    }

    const updatedStagedChanges = currentState.stagedChanges.filter(c => c.id !== changeId);

    setState({
        transactions: updatedTransactions,
        stagedChanges: updatedStagedChanges,
        hasStagedChanges: updatedStagedChanges.length > 0
    });

    renderTransactionsTable();
    updateStagingBanner();
    // --- 結束：原子化的樂觀更新 ---

    // 在背景與伺服器同步，如果失敗則還原 UI
    try {
        // 現在傳遞的是正確的 changeId
        await apiRequest('revert_staged_change', { changeId });
    } catch (error) {
        showNotification('error', `還原操作同步失敗: ${error.message}. 正在回滾UI.`);
        // 發生錯誤時，回滾到執行前的狀態
        setState({
            transactions: currentState.transactions,
            stagedChanges: currentState.stagedChanges,
            hasStagedChanges: currentState.hasStagedChanges,
        });
        renderTransactionsTable();
        updateStagingBanner();
    }
}

// --- Public Function ---

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
