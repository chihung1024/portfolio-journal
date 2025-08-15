// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v1.3 - 支援分頁事件
// =========================================================================================

import { getState, setState } from '../state.js';
// [核心修改] 導入 executeApiAction
import { executeApiAction } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
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
    openModal('transaction-modal', true, transaction);
}

// [核心修改] 此函式現在作為 executeApiAction 成功後的回呼，專門處理後端返回的數據包
function handleSuccessfulUpdate(result) {
    if (!result || !result.data) {
        console.error("handleSuccessfulUpdate 收到的結果無效:", result);
        return;
    }
    
    // 後端在交易操作後會返回完整的最新數據，我們用它來更新前端
    const { holdings, summary, history, twrHistory, netProfitHistory, benchmarkHistory } = result.data;

    const holdingsObject = (holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});

    // 全面更新 state，包含後端回傳的所有圖表歷史數據
    setState({
        holdings: holdingsObject,
        portfolioHistory: history || {},
        twrHistory: twrHistory || {},
        netProfitHistory: netProfitHistory || {},
        benchmarkHistory: benchmarkHistory || {}
    });

    // 更新儀表板和持股列表
    renderHoldingsTable(holdingsObject);
    updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);

    // 主動呼叫圖表更新函式
    updateAssetChart();
    updateNetProfitChart();
    const benchmarkSymbol = summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol);
    
    // 最後，刷新交易列表本身
    // 這裡我們假設需要一個新的API來獲取最新的交易列表，或者從 get_data 獲取
    // 為了簡化，我們先重新渲染一次
    renderTransactionsTable();
}


async function handleDelete(button) {
    const txId = button.dataset.id;
    
    showConfirm('確定要刪除這筆交易紀錄嗎？', () => {
        // [核心修改] 使用 executeApiAction 處理，並在成功後更新 UI
        executeApiAction('delete_transaction', { txId }, {
            loadingText: '正在刪除交易紀錄...',
            successMessage: '交易紀錄已成功刪除！',
            shouldRefreshData: false // 因為後端會直接返回更新後的數據
        }).then(result => {
            // 更新 state 中的 transactions 列表
            const { transactions } = getState();
            const updatedTransactions = transactions.filter(t => t.id !== txId);
            setState({ transactions: updatedTransactions });
            
            // 使用後端返回的數據包更新所有相關 UI
            handleSuccessfulUpdate(result);
        }).catch(error => {
            console.error("刪除交易最終失敗:", error);
            // 由於我們不再做樂觀更新，失敗時無需恢復 UI
        });
    });
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
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

    const action = isEditing ? 'edit_transaction' : 'add_transaction';
    const payload = isEditing ? { txId, txData: transactionData } : transactionData;
    const successMessage = isEditing ? '交易已成功更新！' : '交易已成功新增！';

    // [核心修改] 使用 executeApiAction 處理
    executeApiAction(action, payload, {
        loadingText: '正在同步交易紀錄...',
        successMessage: successMessage,
        shouldRefreshData: false // 後端會直接返回更新後的數據
    }).then(result => {
        // 更新 state 中的 transactions 列表
        const { transactions } = getState();
        if (isEditing) {
            const updatedTransactions = transactions.map(t => 
                t.id === txId ? { ...t, ...transactionData, id: txId } : t
            );
            setState({ transactions: updatedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date)) });
        } else {
            const newTransaction = { ...transactionData, id: result.id };
            const updatedTransactions = [newTransaction, ...transactions];
             setState({ transactions: updatedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date)) });
        }
        
        // 使用後端返回的數據包更新所有相關 UI
        handleSuccessfulUpdate(result);
    }).catch(error => {
        console.error("儲存交易最終失敗:", error);
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
            return;
        }

        // 【新增】處理分頁按鈕點擊
        const pageButton = e.target.closest('.page-btn');
        if (pageButton) {
            e.preventDefault();
            const newPage = parseInt(pageButton.dataset.page, 10);
            if (!isNaN(newPage) && newPage > 0) {
                setState({ transactionsCurrentPage: newPage });
                renderTransactionsTable(); // 重新渲染表格
            }
            return;
        }
    });

    document.getElementById('transactions-tab').addEventListener('change', (e) => {
        if (e.target.id === 'transaction-symbol-filter') {
            // 【修改】當篩選股票時，重置頁碼到第 1 頁
            setState({ 
                transactionFilter: e.target.value,
                transactionsCurrentPage: 1 
            });
            renderTransactionsTable();
        }
    });
}
