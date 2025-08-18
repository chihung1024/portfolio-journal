// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v2.0 - 引導式歸因流程
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, executeApiAction } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
// 【修改】導入新的彈窗控制器
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
    
    // 【修改】編輯時，標題也應為 1/2，但下一步的邏輯不同
    const titleEl = document.getElementById('modal-title');
    if(titleEl) titleEl.textContent = '編輯交易紀錄 (步驟 1/2)';
    
    openModal('transaction-modal', true, transaction);
}

// 維持不變，用於處理後端成功回傳後的 UI 全面刷新
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

/**
 * 【核心重構】處理交易表單 "下一步" 按鈕的點擊事件
 */
async function handleNextStep() {
    // 步驟 1: 從表單收集並驗證數據
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
    
    // 步驟 2: 將驗證後的數據暫存到 state 中
    setState({ tempTransactionData: {
        isEditing,
        txId,
        data: transactionData
    }});

    // 步驟 3: 關閉目前的交易視窗
    closeModal('transaction-modal');

    // 步驟 4: (延遲是為了讓UI動畫更流暢) 立即打開群組歸因視窗
    setTimeout(() => {
        openGroupAttributionModal();
    }, 150);
}

// --- Public Function (公開函式，由 main.js 呼叫) ---

export function initializeTransactionEventListeners() {
    // 【修改】新增交易按鈕現在只負責打開第一步的視窗
    document.getElementById('add-transaction-btn').addEventListener('click', () => {
        setState({ tempTransactionData: null }); // 清空暫存
        const titleEl = document.getElementById('modal-title');
        if(titleEl) titleEl.textContent = '新增交易紀錄 (步驟 1/2)';
        openModal('transaction-modal');
    });

    // 【修改】不再監聽 form 的 submit 事件，而是監聽 "下一步" 按鈕的 click 事件
    document.getElementById('next-step-btn').addEventListener('click', handleNextStep);
    
    // 維持不變
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
        
        // 【新增】為微觀編輯按鈕新增事件監聽器
        const membershipButton = e.target.closest('.edit-membership-btn');
        if (membershipButton) {
            e.preventDefault();
            const txId = membershipButton.dataset.id;
            // 這裡我們會調用一個在 modals.js 中定義的新函式來打開微觀編輯視窗
            openModal('membership-editor-modal', false, { txId });
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
