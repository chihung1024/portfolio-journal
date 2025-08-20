// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v2.1 - 支援非同步微觀編輯
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
    
    const titleEl = document.getElementById('modal-title');
    if(titleEl) titleEl.textContent = '編輯交易紀錄 (步驟 1/2)';
    
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
    
    setState({ tempTransactionData: {
        isEditing,
        txId,
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
        const titleEl = document.getElementById('modal-title');
        if(titleEl) titleEl.textContent = '新增交易紀錄 (步驟 1/2)';
        openModal('transaction-modal');
    });

    document.getElementById('next-step-btn').addEventListener('click', handleNextStep);
    
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));

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
            // 由於 openModal 現在對於此視窗是非同步的，我們在這裡使用 await
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
