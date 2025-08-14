// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v1.2 - Final Chart Sync Fix
// == 職責：處理所有與交易紀錄相關的用戶互動事件。
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { updateDashboard } from '../ui/dashboard.js';

// 【新增】從各自的模組引入圖表更新函式，這是關鍵的第一步
import { updateAssetChart } from '../ui/charts/assetChart.js';
import { updateTwrChart } from '../ui/charts/twrChart.js';
import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';


// --- Private Functions (內部函式) ---

function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    openModal('transaction-modal', true, transaction);
}

// 統一處理成功回應的邏輯
function handleSuccessfulUpdate(result) {
    if (!result.data) return;

    const holdingsObject = (result.data.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});

    // 全面更新 state
    setState({
        holdings: holdingsObject,
        portfolioHistory: result.data.history || {}, // <-- 核心修改：確認鍵名是 "history"
        twrHistory: result.data.twrHistory || {},
        netProfitHistory: result.data.netProfitHistory || {},
        benchmarkHistory: result.data.benchmarkHistory || {}
    });

    // 更新儀表板和持股列表
    renderHoldingsTable(holdingsObject);
    updateDashboard(holdingsObject, result.data.summary?.totalRealizedPL, result.data.summary?.overallReturnRate, result.data.summary?.xirr);

    // 主動呼叫圖表更新函式
    updateAssetChart();
    updateNetProfitChart();
    const benchmarkSymbol = result.data.summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol);
}


async function handleDelete(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    
    const transactionToDelete = transactions.find(t => t.id === txId);
    if (!transactionToDelete) return;

    showConfirm('確定要刪除這筆交易紀錄嗎？', () => {
        const originalTransactions = [...transactions];
        // 樂觀更新：先從畫面上移除
        const updatedTransactions = transactions.filter(t => t.id !== txId);
        setState({ transactions: updatedTransactions });
        renderTransactionsTable();
        showNotification('info', '交易已於介面移除，正在同步至雲端...');

        apiRequest('delete_transaction', { txId })
            .then(result => {
                showNotification('success', '交易紀錄已成功從雲端刪除！');
                // 【修改】呼叫統一的成功處理函式
                handleSuccessfulUpdate(result);
            })
            .catch(error => {
                showNotification('error', `刪除失敗: ${error.message}`);
                // 回滾
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

    // 樂觀更新
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
            // 【修改】呼叫統一的成功處理函式
            handleSuccessfulUpdate(result);
            // 【修正】在新增成功後，需要用後端回傳的真實 ID 更新前端的臨時 ID
            if (!isEditing && result.id) {
                 const finalTransactions = getState().transactions.map(t => t.id === `temp_${Date.now()}` ? { ...t, id: result.id } : t);
                 setState({ transactions: finalTransactions });
                 renderTransactionsTable();
            }
        })
        .catch(error => {
            showNotification('error', `儲存交易失敗: ${error.message}`);
            // 回滾
            setState({ transactions: originalTransactions });
            renderTransactionsTable();
        });
}


// --- Public Function (公開函式，由 main.js 呼叫) ---

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
