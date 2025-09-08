// =========================================================================================
// == 檔案：js/events/transaction.events.js (v_arch_final_cleanup)
// == 職責：處理所有與「交易」相關的 UI 事件，並遵循正確的狀態管理與 API 架構
// =========================================================================================

import { addTransaction, updateTransaction, deleteTransaction } from '../api.js';
// 【核心修正】: 移除对 getState 的依赖，改為導入職責明確的 getTransactions 函式
import { getTransactions } from '../state.js';
import { openModal } from '../ui/modals.js';
import { showNotification, getSymbolCurrency } from '../ui/utils.js';

/**
 * 初始化交易相關的事件監聽器
 */
function initializeTransactionEventListeners() {
    const transactionForm = document.getElementById('transaction-form');
    if (!transactionForm) return;

    // 監聽表單提交（新增或更新）
    transactionForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleSaveTransaction();
    });

    // 透過事件委派處理編輯和刪除按鈕
    document.getElementById('transactions-content')?.addEventListener('click', (event) => {
        const editButton = event.target.closest('.edit-transaction-btn');
        if (editButton) {
            handleEditTransaction(editButton.dataset.id);
            return;
        }

        const deleteButton = event.target.closest('.delete-transaction-btn');
        if (deleteButton) {
            handleDeleteTransaction(deleteButton.dataset.id);
            return;
        }
    });
    
    // 處理 "新增交易" 按鈕
    document.getElementById('add-transaction-btn')?.addEventListener('click', () => {
        transactionForm.reset();
        document.getElementById('transaction-id').value = '';
        document.getElementById('transaction-form-title').textContent = '新增交易';
        openModal('transaction-modal');
    });
}

/**
 * 處理編輯交易的邏輯
 * @param {string} transactionId - 要編輯的交易 ID
 */
function handleEditTransaction(transactionId) {
    // 【核心修正】: 直接呼叫 getTransactions()，不再使用已廢棄的 getState
    const transactions = getTransactions();
    const transaction = transactions.find(t => t.id.toString() === transactionId);
    
    if (!transaction) {
        showNotification('找不到該筆交易', 'error');
        return;
    }

    document.getElementById('transaction-id').value = transaction.id;
    document.getElementById('transaction-form-title').textContent = '編輯交易';
    document.getElementById('transaction-symbol').value = transaction.symbol;
    document.getElementById('transaction-date').value = new Date(transaction.date).toISOString().split('T')[0];
    document.getElementById('transaction-type').value = transaction.type;
    document.getElementById('transaction-quantity').value = transaction.quantity;
    document.getElementById('transaction-price').value = transaction.price_per_share;
    document.getElementById('transaction-currency').value = transaction.currency;

    openModal('transaction-modal');
}

/**
 * 處理儲存交易（新增或更新）的邏輯
 */
async function handleSaveTransaction() {
    const form = document.getElementById('transaction-form');
    const transactionId = document.getElementById('transaction-id').value;
    const symbol = document.getElementById('transaction-symbol').value.toUpperCase();
    
    const transactionData = {
        symbol: symbol,
        date: document.getElementById('transaction-date').value,
        type: document.getElementById('transaction-type').value,
        quantity: parseFloat(document.getElementById('transaction-quantity').value),
        price_per_share: parseFloat(document.getElementById('transaction-price').value),
        currency: document.getElementById('transaction-currency').value.toUpperCase() || getSymbolCurrency(symbol),
    };

    try {
        if (transactionId) {
            await updateTransaction(transactionId, transactionData);
            showNotification('交易更新成功', 'success');
        } else {
            await addTransaction(transactionData);
            showNotification('交易新增成功', 'success');
        }
        document.querySelector('#transaction-modal [data-dismiss]').click(); // 關閉 modal
        form.reset();
    } catch (error) {
        console.error('儲存交易失敗:', error);
        showNotification('儲存交易失敗，請稍後再試', 'error');
    }
}

/**
 * 處理刪除交易的邏輯
 * @param {string} transactionId - 要刪除的交易 ID
 */
async function handleDeleteTransaction(transactionId) {
    if (confirm('您確定要刪除此筆交易嗎？這將會觸發一次重算。')) {
        try {
            await deleteTransaction(transactionId);
            showNotification('交易刪除成功', 'success');
        } catch (error) {
            console.error('刪除交易失敗:', error);
            showNotification('刪除交易失敗，請稍後再試', 'error');
        }
    }
}

export { initializeTransactionEventListeners };
