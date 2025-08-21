// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.0 - ATLAS-COMMIT Architecture
// =========================================================================================

import { getState, setState } from '../state.js';
// [核心修改] 引入新的 API 函式
import { stageChange, getTransactionsWithStaging } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { showNotification } from '../ui/notifications.js';
// [核心修改] 引入 main.js 中的全局刷新函式
import { refreshStagedView } from '../main.js';


// --- Private Functions (內部函式) ---

async function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    // 從融合了暫存態的列表中尋找，確保可以編輯待辦事項
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    
    const titleEl = document.getElementById('modal-title');
    if(titleEl) titleEl.textContent = '編輯交易紀錄';
    
    // 動態導入以避免循環依賴
    const { openModal } = await import('../ui/modals.js');
    openModal('transaction-modal', true, transaction);
}

async function handleDelete(button) {
    const txId = button.dataset.id;
    const { transactions } = getState();
    const txToDelete = transactions.find(t => t.id === txId);
    if (!txToDelete) return;
    
    // [核心修改] 實現樂觀更新與暫存
    
    // 1. 立即在前端模擬刪除
    const originalTransactions = [...transactions];
    const newTransactions = transactions.map(t => 
        t.id === txId ? { ...t, status: 'STAGED_DELETE' } : t
    );
    // 對於一個尚未提交的新增項目，直接從列表中移除
    if (txToDelete.status === 'STAGED_CREATE') {
        const finalTransactions = transactions.filter(t => t.id !== txId);
        setState({ transactions: finalTransactions });
    } else {
        setState({ transactions: newTransactions });
    }
    renderTransactionsTable();
    
    // 2. 在背景將「刪除意圖」提交到暫存區
    try {
        await stageChange({
            op: 'DELETE',
            entity: 'transaction',
            payload: { id: txId }
        });
        // 成功後，調用全局刷新，以獲取後端確認的最新暫存狀態
        await refreshStagedView();
    } catch (error) {
        // 如果 API 失敗，則回滾前端的變更
        showNotification('error', '刪除操作暫存失敗，已還原變更。');
        setState({ transactions: originalTransactions });
        renderTransactionsTable();
    }
}

async function handleSubmitTransaction() {
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

    if (isEditing) {
        transactionData.id = txId;
    }

    if (!transactionData.symbol || isNaN(transactionData.quantity) || isNaN(transactionData.price)) {
        showNotification('error', '請填寫所有必填欄位。');
        return;
    }
    
    const { closeModal } = await import('../ui/modals.js');
    closeModal('transaction-modal');

    // [核心修改] 實現樂觀更新與暫存
    const op = isEditing ? 'UPDATE' : 'CREATE';
    let tempId = null;

    // 1. 立即在前端模擬 新增/編輯
    const { transactions } = getState();
    const originalTransactions = [...transactions];
    let newTransactions;

    if (isEditing) {
        newTransactions = transactions.map(t =>
            t.id === txId ? { ...t, ...transactionData, status: t.status === 'STAGED_CREATE' ? 'STAGED_CREATE' : 'STAGED_UPDATE' } : t
        );
    } else {
        tempId = `temp_${Date.now()}`;
        const newTx = { ...transactionData, id: tempId, status: 'STAGED_CREATE' };
        newTransactions = [newTx, ...transactions];
    }
    
    setState({ transactions: newTransactions });
    renderTransactionsTable();

    // 2. 在背景將「新增/編輯意圖」提交到暫存區
    try {
        await stageChange({
            op: op,
            entity: 'transaction',
            payload: transactionData
        });
        // 成功後，調用全局刷新，以獲取後端確認的最新暫存狀態
        await refreshStagedView();
    } catch (error) {
        showNotification('error', `${isEditing ? '編輯' : '新增'}操作暫存失敗，已還原變更。`);
        setState({ transactions: originalTransactions });
        renderTransactionsTable();
    }
}


// --- Public Function (公開函式，由 main.js 呼叫) ---

export function initializeTransactionEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', async () => {
        const { openModal } = await import('../ui/modals.js');
        // 不需要 isEdit=true/false，因為提交邏輯已統一
        openModal('transaction-modal');
    });

    // 將按鈕的職責單一化
    document.getElementById('confirm-transaction-btn').addEventListener('click', handleSubmitTransaction);
    
    document.getElementById('cancel-transaction-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('transaction-modal');
    });

    // 整個 Tab 的事件監聽
    document.getElementById('transactions-tab').addEventListener('click', async (e) => {
        const editButton = e.target.closest('.edit-btn');
        if (editButton) {
            e.preventDefault();
            handleEdit(editButton);
            return;
        }

        const deleteButton = e.target.closest('.delete-btn');
        if (deleteButton) {
            e.preventDefault();
            handleDelete(deleteButton);
            return;
        }
        
        // 【注意】群組歸屬的微觀編輯，在新架構下需要重新評估。
        // 暫時維持原樣，但它修改的是正式數據而非暫存區，可能會產生非預期行為。
        // 建議在 v1.4 上線穩定後，再將此功能也整合到暫存區流程中。
        const membershipButton = e.target.closest('.edit-membership-btn');
        if (membershipButton) {
            e.preventDefault();
            const txId = membershipButton.dataset.id;
            const { openModal } = await import('../ui/modals.js');
            await openModal('membership-editor-modal', false, { txId });
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
