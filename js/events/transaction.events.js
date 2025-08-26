// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.0.0 - 整合操作隊列
// =========================================================================================

import { getState, setState } from '../state.js';
import { addToQueue } from '../op_queue_manager.js'; // 【新增】引入操作隊列管理器
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { showNotification } from '../ui/notifications.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
// 【移除】不再需要直接與後端溝通的模組
// import { apiRequest, executeApiAction } from '../api.js';
// import { updateDashboard } from '../ui/dashboard.js';
// import { updateAssetChart } from '../ui/charts/assetChart.js';
// import { updateTwrChart } from '../ui/charts/twrChart.js';
// import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';
// import { loadGroups } from './group.events.js';


// --- Private Functions (內部函式) ---

async function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    
    const titleEl = document.getElementById('modal-title');
    if(titleEl) titleEl.textContent = '編輯交易紀錄';
    
    const { openModal } = await import('../ui/modals.js');
    openModal('transaction-modal', true, transaction);
}

async function handleDelete(button) {
    const txId = button.dataset.id;
    
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要刪除這筆交易紀錄嗎？此操作將被暫存，點擊「同步變更」後才會生效。', () => {
        // 【核心修改】將操作加入隊列，而不是直接呼叫 API
        const success = addToQueue('DELETE', 'transaction', { txId });
        
        if (success) {
            showNotification('info', '交易已標記為刪除。點擊同步按鈕以儲存變更。');
            // 立即使用更新後的 state 重新渲染 UI
            renderTransactionsTable();
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
    
    const { closeModal } = await import('../ui/modals.js');
    closeModal('transaction-modal');

    // 【核心修改】將新增或編輯操作加入隊列
    if (isEditing) {
        const payload = { txId: txId, txData: transactionData };
        const success = addToQueue('UPDATE', 'transaction', payload);
        if (success) {
            showNotification('info', '交易變更已暫存。點擊同步按鈕以儲存。');
            renderTransactionsTable();
        }
    } else {
        const success = addToQueue('CREATE', 'transaction', transactionData);
        if (success) {
            showNotification('info', '新交易已暫存。點擊同步按鈕以儲存。');
            renderTransactionsTable();
        }
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