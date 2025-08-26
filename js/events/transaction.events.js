// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.1 - Bug Fix
// =========================================================================================

import { getState, setState } from '../state.js';
import { stagingService } from '../staging.service.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { showNotification } from '../ui/notifications.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';

// --- Private Functions (內部函式) ---

async function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    
    // 【核心修正】從 state 和 staging area 合併數據源，確保能編輯尚未提交的項目
    const stagedActions = await stagingService.getStagedActions();
    const stagedTransactions = stagedActions
        .filter(a => a.entity === 'transaction' && a.type !== 'DELETE')
        .map(a => a.payload);

    const combined = [...transactions];
    stagedTransactions.forEach(stagedTx => {
        const index = combined.findIndex(t => t.id === stagedTx.id);
        if (index > -1) {
            combined[index] = { ...combined[index], ...stagedTx }; // Update existing
        } else {
            combined.push(stagedTx); // Add new
        }
    });

    const transaction = combined.find(t => t.id === txId);
    if (!transaction) {
        showNotification('error', '找不到要編輯的交易紀錄。');
        return;
    }
    
    const { openModal } = await import('../ui/modals.js');
    openModal('transaction-modal', true, transaction);
}

/**
 * 操作成功存入暫存區後，更新 UI
 */
async function handleStagingSuccess() {
    showNotification('info', '操作已暫存。點擊「全部提交」以同步至雲端。');
    await renderTransactionsTable();
    const { holdings } = getState();
    await renderHoldingsTable(holdings); 
}


async function handleDelete(button) {
    const txId = button.dataset.id;
    
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('您確定要刪除這筆交易紀錄嗎？此操作將被加入暫存區。', async () => {
        try {
            await stagingService.addAction('DELETE', 'transaction', { id: txId });
            await handleStagingSuccess();
        } catch (error) {
            showNotification('error', `暫存刪除操作失敗: ${error.message}`);
        }
    });
}

async function handleNextStep() {
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
    
    const { closeModal, openGroupAttributionModal } = await import('../ui/modals.js');
    closeModal('transaction-modal');

    if (isEditing) {
        try {
            await stagingService.addAction('UPDATE', 'transaction', { id: txId, ...transactionData });
            await handleStagingSuccess();
        } catch (error) {
             showNotification('error', `暫存更新操作失敗: ${error.message}`);
        }
    } else {
        const tempId = `temp_${Date.now()}`;
        setState({ tempTransactionData: {
            isEditing: false,
            txId: tempId,
            data: { id: tempId, ...transactionData }
        }});

        setTimeout(() => {
            openGroupAttributionModal();
        }, 150);
    }
}

// --- Public Function (公開函式，由 main.js 呼叫) ---

export function initializeTransactionEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', async () => {
        setState({ tempTransactionData: null });
        const { openModal } = await import('../ui/modals.js');
        openModal('transaction-modal');
    });

    document.getElementById('confirm-transaction-btn').addEventListener('click', handleNextStep);
    
    document.getElementById('cancel-transaction-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('transaction-modal');
    });
    
    document.getElementById('transaction-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('confirm-transaction-btn').click();
        }
    });

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
