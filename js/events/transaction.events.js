// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v2.2 - 分離編輯與新增流程
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, executeApiAction } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { openModal, closeModal, showConfirm, openGroupAttributionModal } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { updateDashboard } from '../ui/dashboard.js';
import { updateAssetChart } from '../ui/charts/assetChart.js';
import { updateTwrChart } from '../ui/charts/twrChart.js';
import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';


// --- Private Functions (內部函式) ---

function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    
    // openModal 已經會處理標題和按鈕的顯示/隱藏
    openModal('transaction-modal', true, transaction);
}

function handleSuccessfulUpdate(result) {
    if (!result || !result.data) {
        console.error("handleSuccessfulUpdate 收到的結果無效:", result);
        return;
    }
    
    const { holdings, summary, history, twrHistory, netProfitHistory, benchmarkHistory } = result.data;

    const holdingsObject = (holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});

    setState({
        holdings: holdingsObject,
        portfolioHistory: history || {},
        twrHistory: twrHistory || {},
        netProfitHistory: netProfitHistory || {},
        benchmarkHistory: benchmarkHistory || {}
    });

    renderHoldingsTable(holdingsObject);
    updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);

    updateAssetChart();
    updateNetProfitChart();
    const benchmarkSymbol = summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol);
    
    // 異步更新交易列表的數據源
    apiRequest('get_transactions_and_splits', {}).then(res => {
        if (res.success) {
            setState({
                transactions: res.data.transactions || [],
                userSplits: res.data.splits || [],
            });
            renderTransactionsTable();
        }
    });
}

/**
 * 【核心修改】此函式現在專門處理「編輯交易」表單的提交
 */
async function handleTransactionFormSubmit(e) {
    e.preventDefault(); // 防止瀏覽器預設的表單提交行為
    
    const txId = document.getElementById('transaction-id').value;
    // 再次確認這是在編輯模式下
    if (!txId) return;

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

    // 直接呼叫 edit_transaction API，不再進入群組選擇步驟
    executeApiAction('edit_transaction', { txId, txData: transactionData }, {
        loadingText: '正在更新交易紀錄...',
        successMessage: '交易紀錄已成功更新！',
        shouldRefreshData: false // 我們將在 then() 中手動處理數據刷新
    }).then(result => {
        handleSuccessfulUpdate(result);
    }).catch(error => {
        console.error("編輯交易最終失敗:", error);
    });
}


async function handleDelete(button) {
    const txId = button.dataset.id;
    
    showConfirm('確定要刪除這筆交易紀錄嗎？此操作將同時移除此交易在所有群組中的紀錄。', () => {
        executeApiAction('delete_transaction', { txId }, {
            loadingText: '正在刪除交易紀錄...',
            successMessage: '交易紀錄已成功刪除！',
            shouldRefreshData: false 
        }).then(result => {
            const { transactions } = getState();
            const updatedTransactions = transactions.filter(t => t.id !== txId);
            setState({ transactions: updatedTransactions });
            
            handleSuccessfulUpdate(result);
        }).catch(error => {
            console.error("刪除交易最終失敗:", error);
        });
    });
}

/**
 * 此函式現在專門處理「新增交易」流程的第一步
 */
async function handleNextStep() {
    const txId = document.getElementById('transaction-id').value;
    // 確保這不是編輯模式
    if (txId) return;

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
    
    setState({ tempTransactionData: {
        isEditing: false, // 明確設定為 false
        txId: null,
        data: transactionData
    }});

    closeModal('transaction-modal');

    setTimeout(() => {
        openGroupAttributionModal();
    }, 150);
}

// --- Public Function (公開函式，由 main.js 呼叫) ---

export function initializeTransactionEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', () => {
        setState({ tempTransactionData: null });
        // openModal 會處理標題和按鈕
        openModal('transaction-modal');
    });

    // 【核心修改】分離事件監聽
    // 「下一步」按鈕只用於新增流程
    document.getElementById('next-step-btn').addEventListener('click', handleNextStep);
    // 表單的 submit 事件只用於編輯流程
    document.getElementById('transaction-form').addEventListener('submit', handleTransactionFormSubmit);
    
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));

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
