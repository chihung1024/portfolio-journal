// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v1.3 - 支援分頁事件
// =========================================================================================

import { getState, setState } from '../state.js';
// [核心修改] 導入 executeApiAction 和 apiRequest
import { apiRequest, executeApiAction } from '../api.js';
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
    renderTransactionsTable();
}


async function handleDelete(button) {
    const txId = button.dataset.id;
    
    showConfirm('確定要刪除這筆交易紀錄嗎？', () => {
        // [核心修改] 使用 executeApiAction 處理指令式流程
        executeApiAction('delete_transaction', { txId }, {
            loadingText: '正在刪除交易紀錄...',
            successMessage: '交易紀錄已成功刪除！',
            // 關鍵：我們依賴後端返回的數據包，所以不在 executeApiAction 內部自動刷新
            shouldRefreshData: false 
        }).then(result => {
            // API 成功後，用權威數據更新前端
            // 首先手動更新交易列表本身
            const { transactions } = getState();
            const updatedTransactions = transactions.filter(t => t.id !== txId);
            setState({ transactions: updatedTransactions });
            
            // 然後用後端返回的數據包更新所有其他相關 UI
            handleSuccessfulUpdate(result);
        }).catch(error => {
            console.error("刪除交易最終失敗:", error);
            // 失敗時，錯誤通知已由 executeApiAction 自動顯示，我們無需做任何 UI 回滾
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

    // [核心修改] 使用 executeApiAction 處理指令式流程
    executeApiAction(action, payload, {
        loadingText: '正在同步交易紀錄...',
        successMessage: successMessage,
        shouldRefreshData: false
    }).then(result => {
        // API 成功後，用權威數據更新前端
        // 為了確保交易列表（包含新增的ID或編輯的內容）完全正確，
        // 我們需要一個包含最新交易列表的數據源。
        // 最可靠的方式是重新請求一次 get_data。
        apiRequest('get_data', {}).then(fullData => {
            setState({ transactions: fullData.data.transactions || [] });
            
            // 然後使用先前操作返回的、計算好的數據包更新所有其他UI
            handleSuccessfulUpdate(result);
        });
    }).catch(error => {
        console.error("儲存交易最終失敗:", error);
        // 同樣，失敗時無需做任何 UI 回滾
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
