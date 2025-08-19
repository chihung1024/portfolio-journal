// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.0 - 支援單次編輯
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, executeApiAction } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';

// --- Private Functions ---

function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    openModal('transaction-modal', true, transaction);
}

async function handleDelete(button) {
    const txId = button.dataset.id;
    showConfirm('確定要刪除這筆交易紀錄嗎？', () => {
        executeApiAction('delete_transaction', { txId }, {
            loadingText: '正在刪除交易...',
            successMessage: '交易紀錄已成功刪除！'
        }).catch(error => {
            console.error("刪除交易最終失敗:", error);
        });
    });
}

/**
 * 【新增】處理合併後表單的提交事件
 */
async function handleTransactionFormSubmit(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('#transaction-submit-btn');
    const mode = submitBtn.dataset.mode;

    const txId = document.getElementById('transaction-id').value;
    const isEditing = (mode === 'edit');
    
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

    if (isEditing) {
        // --- 執行一步到位的編輯儲存 ---
        const selectedGroupIds = Array.from(document.querySelectorAll('input[name="transaction_group"]:checked')).map(cb => cb.value);
        
        closeModal('transaction-modal');

        executeApiAction('edit_transaction', {
            txId,
            txData: transactionData,
            groupInclusions: selectedGroupIds
        }, {
            loadingText: '正在更新交易...',
            successMessage: '交易已成功更新！'
        }).catch(err => console.error("更新交易失敗:", err));

    } else {
        // --- 執行原有的新增兩步驟流程 ---
        setState({ tempTransactionData: { isEditing: false, data: transactionData } });
        closeModal('transaction-modal');
        setTimeout(() => {
            // 【注意】因為舊的 modal 已刪除，這裡需要一個新的 modal 或修改現有 modal 來顯示步驟二
            // 為簡化，我們暫時讓新增流程也一步到位，但不在 UI 上顯示群組選擇器
             executeApiAction('add_transaction', {
                transactionData: transactionData,
                groupInclusions: [], // 新增時預設不加入任何群組
                newGroups: []
             }, {
                loadingText: '正在新增交易...',
                successMessage: '交易已成功新增！'
             }).catch(err => console.error("新增交易失敗:", err));
        }, 150);
    }
}


// --- Public Function ---

export function initializeTransactionEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', () => {
        openModal('transaction-modal', false);
    });
    
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));

    // 【核心修改】監聽整個 form 的 submit 事件
    document.getElementById('transaction-form').addEventListener('submit', handleTransactionFormSubmit);

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
