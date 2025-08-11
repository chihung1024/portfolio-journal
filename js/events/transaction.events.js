// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v1.1 - Optimistic UI
// == 職責：處理所有與交易紀錄相關的用戶互動事件。
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
// 【新增】引入儀表板和持股列表的渲染函式
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { updateDashboard } from '../ui/dashboard.js';

// --- Private Functions (only used within this module) ---

// 【移除】不再需要 requestDataSync 函式，因為我們不再發起第二次請求
/*
async function requestDataSync() {
    if (getState().isSyncing) {
        console.log("數據同步中，已忽略本次請求。");
        return;
    }
    try {
        setState({ isSyncing: true });
        await loadPortfolioData();
    } catch (error) {
        console.error("請求同步時發生錯誤:", error);
    } finally {
        setState({ isSyncing: false });
    }
}
*/

function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    openModal('transaction-modal', true, transaction);
}

async function handleDelete(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    
    const transactionToDelete = transactions.find(t => t.id === txId);
    if (!transactionToDelete) return;

    showConfirm('確定要刪除這筆交易紀錄嗎？', () => {
        const originalTransactions = [...transactions];
        const updatedTransactions = transactions.filter(t => t.id !== txId);
        setState({ transactions: updatedTransactions });

        renderTransactionsTable();
        showNotification('info', '交易已於介面移除，正在同步至雲端...');

        apiRequest('delete_transaction', { txId })
            .then(result => {
                showNotification('success', '交易紀錄已成功從雲端刪除！');
                
                // 【修改】核心變更：不再呼叫 requestDataSync()
                // requestDataSync(); 

                // 【新增】直接使用 API 回應的數據來更新 state 和 UI
                if (result.data) {
                    const holdingsObject = (result.data.holdings || []).reduce((obj, item) => {
                        obj[item.symbol] = item; return obj;
                    }, {});
                    
                    setState({ holdings: holdingsObject });

                    renderHoldingsTable(holdingsObject);
                    updateDashboard(holdingsObject, result.data.summary?.totalRealizedPL, result.data.summary?.overallReturnRate, result.data.summary?.xirr);
                }
            })
            .catch(error => {
                showNotification('error', `刪除失敗: ${error.message}`);
                setState({ transactions: originalTransactions });
                renderTransactionsTable();
            });
    });
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    const { transactions } = getState();
    const originalTransactions = [...transactions];

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

    if (isEditing) {
        const updatedTransactions = transactions.map(t => 
            t.id === txId ? { ...t, ...transactionData, id: txId } : t
        );
        setState({ transactions: updatedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date)) });
    } else {
        const tempId = `temp_${Date.now()}`;
        const newTransaction = { id: tempId, ...transactionData };
        const updatedTransactions = [newTransaction, ...transactions];
        setState({ transactions: updatedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date)) });
    }

    renderTransactionsTable();
    showNotification('info', '交易已更新於介面，正在同步至雲端...');

    const action = isEditing ? 'edit_transaction' : 'add_transaction';
    const payload = isEditing ? { txId, txData: transactionData } : transactionData;

    apiRequest(action, payload)
        .then(result => {
            showNotification('success', isEditing ? '交易已成功更新！' : '交易已成功新增！');
            
            // 【修改】核心變更：不再呼叫 requestDataSync()
            // requestDataSync();
            
            // 【新增】直接使用 API 回應的數據來更新 state 和 UI
            if (result.data) {
                const holdingsObject = (result.data.holdings || []).reduce((obj, item) => {
                    obj[item.symbol] = item; return obj;
                }, {});

                setState({ holdings: holdingsObject });

                renderHoldingsTable(holdingsObject);
                updateDashboard(holdingsObject, result.data.summary?.totalRealizedPL, result.data.summary?.overallReturnRate, result.data.summary?.xirr);
            }
        })
        .catch(error => {
            showNotification('error', `儲存交易失敗: ${error.message}`);
            setState({ transactions: originalTransactions });
            renderTransactionsTable();
        });
}


// --- Public Function (exported to be called from main.js) ---

export function initializeTransactionEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', () => openModal('transaction-modal'));
    document.getElementById('transaction-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));

    document.getElementById('transactions-tab').addEventListener('click', (e) => {
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
        }
    });

    document.getElementById('transactions-tab').addEventListener('change', (e) => {
        if (e.target.id === 'transaction-symbol-filter') {
            setState({ transactionFilter: e.target.value });
            renderTransactionsTable();
        }
    });
}
