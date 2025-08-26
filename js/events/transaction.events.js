// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.0 - 整合暫存區
// =========================================================================================

import { getState, setState } from '../state.js';
import { stagingService } from '../staging.service.js'; // 【核心修改】
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { showNotification } from '../ui/notifications.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';

// --- Private Functions (內部函式) ---

async function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    // 【優化】同時檢查暫存區，確保能編輯尚未提交的新項目
    const allTxs = [...transactions, ...(await stagingService.getStagedEntities('transaction'))];
    const transaction = allTxs.find(t => t.id === txId);
    if (!transaction) return;
    
    const { openModal } = await import('../ui/modals.js');
    openModal('transaction-modal', true, transaction);
}

/**
 * 【核心修改】操作成功存入暫存區後，更新 UI
 */
function handleStagingSuccess() {
    showNotification('info', '操作已暫存。點擊「全部提交」以同步至雲端。');
    
    // 立即重新渲染交易列表以顯示暫存狀態
    renderTransactionsTable();

    // 注意：此處暫不重新計算儀表板，因為這只是前端暫存。
    // 也可以選擇性地觸發一個輕量級的前端預覽更新。
    const { holdings } = getState();
    renderHoldingsTable(holdings); 
}


async function handleDelete(button) {
    const txId = button.dataset.id;
    
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('您確定要刪除這筆交易紀錄嗎？此操作將被加入暫存區。', async () => {
        try {
            await stagingService.addAction('DELETE', 'transaction', { id: txId });
            handleStagingSuccess();
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
        // 【核心修改】編輯模式下，將更新操作加入暫存區
        try {
            await stagingService.addAction('UPDATE', 'transaction', { id: txId, ...transactionData });
            handleStagingSuccess();
        } catch (error) {
             showNotification('error', `暫存更新操作失敗: ${error.message}`);
        }
    } else {
        // 新增模式，進入第二步的群組歸屬流程 (最終也會存入暫存區)
        const tempId = `temp_${Date.now()}`;
        setState({ tempTransactionData: {
            isEditing: false,
            txId: tempId, // 使用臨時ID
            data: { id: tempId, ...transactionData } // 將臨時ID也加入payload
        }});

        setTimeout(() => {
            openGroupAttattributionModal();
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