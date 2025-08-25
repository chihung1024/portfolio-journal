// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.1 - Fix Staging UX Flow
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { showNotification } from '../ui/notifications.js';
import { updateStagingBanner } from '../ui/components/stagingBanner.ui.js';

/**
 * 重新載入包含暫存狀態的交易列表並更新UI
 */
async function reloadTransactionsAndUpdateUI() {
    try {
        const result = await apiRequest('get_transactions_with_staging');
        if (result.success) {
            setState({
                transactions: result.data.transactions || [],
                hasStagedChanges: result.data.hasStagedChanges
            });
            renderTransactionsTable();
            updateStagingBanner();
        }
    } catch (error) {
        showNotification('error', `刷新交易列表失敗: ${error.message}`);
    }
}


/**
 * 處理刪除按鈕點擊，將其轉為暫存操作
 */
async function handleDelete(button) {
    const txId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('這筆交易將被標記為待刪除，在您點擊「全部提交」後才會真正刪除。確定嗎？', async () => {
        const change = {
            op: 'DELETE',
            entity: 'transaction',
            payload: { id: txId }
        };
        try {
            const result = await apiRequest('stage_change', change);
            if (result.success) {
                showNotification('info', `刪除操作已加入暫存區。`);
                await reloadTransactionsAndUpdateUI();
            }
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        }
    });
}

/**
 * 處理復原刪除按鈕點擊
 */
async function handleRevertDelete(button) {
    const changeId = button.dataset.changeId;
    try {
        await apiRequest('revert_staged_change', { changeId });
        showNotification('success', '刪除操作已成功復原。');
        await reloadTransactionsAndUpdateUI();
    } catch (error) {
        showNotification('error', `復原失敗: ${error.message}`);
    }
}

// ========================= 【核心修改 - 開始】 =========================
/**
 * 處理交易表單的第一步提交/下一步
 */
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
        // 【編輯模式】：直接將 UPDATE 操作加入暫存區
        transactionData.id = txId;
        const change = {
            op: 'UPDATE',
            entity: 'transaction',
            payload: transactionData
        };
        try {
            await apiRequest('stage_change', change);
            showNotification('info', `交易修改已加入暫存區。`);
            await reloadTransactionsAndUpdateUI();
        } catch (error) {
            showNotification('error', `操作失敗: ${error.message}`);
        }
    } else {
        // 【新增模式】：將資料暫存，並開啟第二步的群組歸屬視窗
        setState({ tempTransactionData: {
            isEditing: false,
            txId: null, // 新增時沒有 txId
            data: transactionData
        }});

        setTimeout(() => {
            openGroupAttributionModal();
        }, 150);
    }
}
// ========================= 【核心修改 - 結束】 =========================


export function initializeTransactionEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', async () => {
        // 清除上一次的暫存資料
        setState({ tempTransactionData: null });
        const { openModal } = await import('../ui/modals.js');
        openModal('transaction-modal');
    });

    // 【修改】將事件處理器綁定到新的 handleNextStep 函式
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
            const { transactions } = getState();
            const txId = editButton.dataset.id;
            const transaction = transactions.find(t => t.id === txId);
            if (!transaction) return;
            const { openModal } = await import('../ui/modals.js');
            // 傳入的 transaction 物件可能包含 status，modal 會忽略它，是安全的
            openModal('transaction-modal', true, transaction);
            return;
        }

        const deleteButton = e.target.closest('.delete-btn');
        if (deleteButton) {
            e.preventDefault();
            handleDelete(deleteButton);
            return;
        }

        const revertButton = e.target.closest('.revert-delete-btn');
        if (revertButton) {
            e.preventDefault();
            handleRevertDelete(revertButton);
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