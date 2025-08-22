// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v2.2 - 修正匯率欄位送出邏輯
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, executeApiAction } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
// import { openModal, closeModal, showConfirm, openGroupAttributionModal } from '../ui/modals.js'; // 移除靜態導入
import { showNotification } from '../ui/notifications.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { updateDashboard } from '../ui/dashboard.js';
import { updateAssetChart } from '../ui/charts/assetChart.js';
import { updateTwrChart } from '../ui/charts/twrChart.js';
import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';
import { loadGroups } from './group.events.js'; // 【BUG FIX】導入 loadGroups 函式


// --- Private Functions (內部函式) ---

async function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    
    // 確保標題正確
    const titleEl = document.getElementById('modal-title');
    if(titleEl) titleEl.textContent = '編輯交易紀錄';
    
    const { openModal } = await import('../ui/modals.js');
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
    
    renderTransactionsTable();
}


async function handleDelete(button) {
    const txId = button.dataset.id;
    
    const { showConfirm } = await import('../ui/modals.js');
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
            loadGroups(); // 【BUG FIX】在刪除成功後，手動刷新群組列表
        }).catch(error => {
            console.error("刪除交易最終失敗:", error);
        });
    });
}

async function handleNextStep() {
    const txId = document.getElementById('transaction-id').value;
    const isEditing = !!txId;
    
    // ========================= 【核心修改 - 開始】 =========================
    const exchangeRateInput = document.getElementById('exchange-rate').value;
    const exchangeRateValue = exchangeRateInput.trim() === '' ? null : parseFloat(exchangeRateInput);
    // ========================= 【核心修改 - 結束】 =========================

    const transactionData = {
        date: document.getElementById('transaction-date').value,
        symbol: document.getElementById('stock-symbol').value.toUpperCase().trim(),
        type: document.querySelector('input[name="transaction-type"]:checked').value,
        quantity: parseFloat(document.getElementById('quantity').value),
        price: parseFloat(document.getElementById('price').value),
        currency: document.getElementById('currency').value,
        totalCost: parseFloat(document.getElementById('total-cost').value) || null,
        exchangeRate: exchangeRateValue // 使用我們處理過的值
    };

    if (!transactionData.symbol || isNaN(transactionData.quantity) || isNaN(transactionData.price)) {
        showNotification('error', '請填寫所有必填欄位。');
        return;
    }
    
    const { closeModal, openGroupAttributionModal } = await import('../ui/modals.js');
    closeModal('transaction-modal');

    if (isEditing) {
        // 【核心修改】如果是編輯模式，直接儲存，不再進入第二步
        const payloadForApi = { txId: txId, txData: transactionData };
        executeApiAction('edit_transaction', payloadForApi, {
            loadingText: '正在儲存變更...',
            successMessage: '交易已成功更新！',
            shouldRefreshData: false
        }).then(result => {
             // 編輯成功後，需要手動更新 state 中的 transactions 陣列
            const { transactions } = getState();
            const updatedTransactions = transactions.map(t => t.id === txId ? { ...t, ...transactionData } : t);
            setState({ transactions: updatedTransactions });
            handleSuccessfulUpdate(result);
            loadGroups(); // 【BUG FIX】手動刷新群組列表
        }).catch(error => {
            console.error("編輯交易最終失敗:", error);
        });
    } else {
        // 【維持不變】如果是新增模式，則進入第二步的群組歸屬流程
        setState({ tempTransactionData: {
            isEditing,
            txId,
            data: transactionData
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

    document.getElementById('transactions-tab').addEventListener('click', async (e) => { // 【修改】將整個監聽器改為 async
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
