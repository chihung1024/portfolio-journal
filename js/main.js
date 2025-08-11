// =========================================================================================
// == 主程式進入點 (main.js) v3.5.1 - 樂觀更新 + 同步鎖
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, loadPortfolioData } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';
import { 
    openModal, 
    closeModal, 
    showConfirm, 
    hideConfirm, 
    toggleOptionalFields, 
    showNotification,
    switchTab,
    renderTransactionsTable,
    renderDividendsManagementTab,
    getDateRangeForPreset,
} from './ui.js';
import { initializeAssetChart } from './ui/charts/assetChart.js';
import { initializeTwrChart } from './ui/charts/twrChart.js';
import { initializeNetProfitChart, updateNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderHoldingsTable } from './ui/components/holdings.ui.js';

// --- 事件處理函式 ---

// [新增] 一個帶有鎖定機制的數據同步請求函式
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


function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    openModal('transaction-modal', true, transaction);
}

// [優化] 使用樂觀更新重構 handleDelete
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
                requestDataSync(); // [修改] 使用新的同步函式
            })
            .catch(error => {
                showNotification('error', `刪除失敗: ${error.message}`);
                setState({ transactions: originalTransactions });
                renderTransactionsTable();
            });
    });
}

// [優化] 使用樂觀更新重構 handleFormSubmit
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
            requestDataSync(); // [修改] 使用新的同步函式
        })
        .catch(error => {
            showNotification('error', `儲存交易失敗: ${error.message}`);
            setState({ transactions: originalTransactions });
            renderTransactionsTable();
        });
}

// 以下為其他未變動的函式...
async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    showConfirm('確定要刪除這個拆股事件嗎？', async () => {
        try {
            await apiRequest('delete_split', { splitId });
            showNotification('success', '拆股事件已刪除！');
            await loadPortfolioData();
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        }
    });
}

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-split-btn');
    saveBtn.disabled = true;
    const splitData = { date: document.getElementById('split-date').value, symbol: document.getElementById('split-symbol').value.toUpperCase().trim(), ratio: parseFloat(document.getElementById('split-ratio').value) };
    if (!splitData.symbol || isNaN(splitData.ratio) || splitData.ratio <= 0) {
        showNotification('error', '請填寫所有欄位並確保比例大於0。');
        saveBtn.disabled = false; return;
    }
    try {
        await apiRequest('add_split', splitData);
        closeModal('split-modal');
        await loadPortfolioData();
    } catch (error) {
        showNotification('error', `新增拆股事件失敗: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存';
    }
}

async function handleUpdateBenchmark() {
    const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
    if (!newBenchmark) { showNotification('error', '請輸入 Benchmark 的股票代碼。'); return; }
    try {
        document.getElementById('loading-overlay').style.display = 'flex';
        await apiRequest('update_benchmark', { benchmarkSymbol: newBenchmark });
        await loadPortfolioData();
    } catch(error) {
        showNotification('error', `更新 Benchmark 失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

async function handleNotesFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-notes-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';
    const noteData = {
        symbol: document.getElementById('notes-symbol').value,
        target_price: parseFloat(document.getElementById('target-price').value) || null,
        stop_loss_price: parseFloat(document.getElementById('stop-loss-price').value) || null,
        notes: document.getElementById('notes-content').value.trim()
    };
    try {
        await apiRequest('save_stock_note', noteData);
        closeModal('notes-modal');
        const { holdings, stockNotes } = getState();
        stockNotes[noteData.symbol] = { ...stockNotes[noteData.symbol], ...noteData };
        setState({ stockNotes });
        renderHoldingsTable(holdings);
        showNotification('success', `${noteData.symbol} 的筆記已儲存！`);
    } catch (error) {
        showNotification('error', `儲存筆記失敗: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存筆記';
    }
}

async function loadAndShowDividends() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';
    try {
        const result = await apiRequest('get_dividends_for_management', {});
        if (result.success) {
            setState({
                pendingDividends: result.data.pendingDividends,
                confirmedDividends: result.data.confirmedDividends,
            });
            renderDividendsManagementTab(result.data.pendingDividends, result.data.confirmedDividends);
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        showNotification('error', `讀取配息資料失敗: ${error.message}`);
    } finally {
        overlay.style.display = 'none';
    }
}

async function handleBulkConfirm() {
    const { pendingDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }
    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？系統將套用預設稅率與發放日期。`, async () => {
        try {
            document.getElementById('loading-overlay').style.display = 'flex';
            await apiRequest('bulk_confirm_all_dividends', { pendingDividends });
            showNotification('success', '所有待確認配息已處理完畢！');
            await loadAndShowDividends(); 
            await loadPortfolioData(); 
        } catch (error) {
            showNotification('error', `批次確認失敗: ${error.message}`);
        } finally {
            document.getElementById('loading-overlay').style.display = 'none';
        }
    });
}

async function handleDividendFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-dividend-btn');
    saveBtn.disabled = true;
    const id = document.getElementById('dividend-id').value;
    const isEditing = !!id;
    const dividendData = {
        symbol: document.getElementById('dividend-symbol').value,
        ex_dividend_date: document.getElementById('dividend-ex-date').value,
        pay_date: document.getElementById('dividend-pay-date').value,
        currency: document.getElementById('dividend-currency').value,
        quantity_at_ex_date: parseFloat(document.getElementById('dividend-quantity').value),
        amount_per_share: parseFloat(document.getElementById('dividend-original-amount-ps').value),
        total_amount: parseFloat(document.getElementById('dividend-total-amount').value),
        tax_rate: parseFloat(document.getElementById('dividend-tax-rate').value) || 0,
        notes: document.getElementById('dividend-notes').value.trim()
    };
    if (isEditing) { dividendData.id = id; }
    try {
        await apiRequest('save_user_dividend', dividendData);
        closeModal('dividend-modal');
        showNotification('success', '配息紀錄已儲存！');
        await loadAndShowDividends();
        await loadPortfolioData();
    } catch (error) {
        showNotification('error', `儲存失敗: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存紀錄';
    }
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    showConfirm('確定要刪除這筆已確認的配息紀錄嗎？', async () => {
        try {
            document.getElementById('loading-overlay').style.display = 'flex';
            await apiRequest('delete_user_dividend', { dividendId });
            showNotification('success', '配息紀錄已刪除！');
            await loadAndShowDividends();
            await loadPortfolioData();
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        } finally {
            document.getElementById('loading-overlay').style.display = 'none';
        }
    });
}

function handleChartRangeChange(chartType, rangeType, startDate = null, endDate = null) {
    const { updateAssetChart } = require("./ui/charts/assetChart.js");
    const { updateTwrChart } = require("./ui/charts/twrChart.js");

    const stateKey = chartType === 'twr' ? 'twrDateRange' 
                   : chartType === 'asset' ? 'assetDateRange' 
                   : 'netProfitDateRange';
    const historyKey = chartType === 'twr' ? 'twrHistory' 
                     : chartType === 'asset' ? 'portfolioHistory' 
                     : 'netProfitHistory';
    const controlsId = chartType === 'twr' ? 'twr-chart-controls' 
                     : chartType === 'asset' ? 'asset-chart-controls' 
                     : 'net-profit-chart-controls';
    
    // 【修正】更新 chartType === 'net-profit' 時的 stateKey 和 historyKey
    const finalStateKey = chartType === 'net-profit' ? 'netProfitDateRange' : stateKey;
    const finalHistoryKey = chartType === 'net-profit' ? 'netProfitHistory' : historyKey;

    const newRange = { type: rangeType, start: startDate, end: endDate };
    setState({ [finalStateKey]: newRange });
    
    document.querySelectorAll(`#${controlsId} .chart-range-btn`).forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.range === rangeType) btn.classList.add('active');
    });

    const fullHistory = getState()[finalHistoryKey];
    const { startDate: finalStartDate, endDate: finalEndDate } = getDateRangeForPreset(fullHistory, newRange);

    if (rangeType !== 'custom') {
        const startDateInput = document.getElementById(`${chartType}-start-date`);
        const endDateInput = document.getElementById(`${chartType}-end-date`);
        if (startDateInput && endDateInput) {
            startDateInput.value = finalStartDate;
            endDateInput.value = finalEndDate;
        }
    }
    
    if (chartType === 'twr') {
        const benchmarkSymbol = document.getElementById('benchmark-symbol-input')
            .value.toUpperCase().trim() || 'SPY';
        updateTwrChart(benchmarkSymbol);
    } else if (chartType === 'asset') {
        updateAssetChart();
    } else if (chartType === 'net-profit') { // 【修正】此處的判斷條件
        updateNetProfitChart();
    }
}

function setupCommonEventListeners() {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirm);
    document.getElementById('confirm-ok-btn').addEventListener('click', () => { 
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); } 
        hideConfirm(); 
    });
}

function setupMainAppEventListeners() {
    // --- 這部分是非圖表相關的事件監聽，維持不變 ---
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('add-transaction-btn').addEventListener('click', () => openModal('transaction-modal'));
    document.getElementById('transaction-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));

    document.getElementById('transactions-tab').addEventListener('click', (e) => {
        const editButton = e.target.closest('.edit-btn');
        if (editButton) { e.preventDefault(); handleEdit(editButton); return; }
        const deleteButton = e.target.closest('.delete-btn');
        if (deleteButton) { e.preventDefault(); handleDelete(deleteButton); }
    });
    document.getElementById('transactions-tab').addEventListener('change', (e) => {
        if (e.target.id === 'transaction-symbol-filter') {
            setState({ transactionFilter: e.target.value });
            renderTransactionsTable();
        }
    });
    
    const manageSplitsBtn = document.getElementById('manage-splits-btn');
    if(manageSplitsBtn) manageSplitsBtn.addEventListener('click', () => openModal('split-modal'));
    document.getElementById('split-form').addEventListener('submit', handleSplitFormSubmit);
    document.getElementById('cancel-split-btn').addEventListener('click', () => closeModal('split-modal'));
    document.getElementById('splits-table-body').addEventListener('click', (e) => { 
        const btn = e.target.closest('.delete-split-btn');
        if(btn) handleDeleteSplit(btn);
    });
    
    document.getElementById('update-benchmark-btn').addEventListener('click', handleUpdateBenchmark);
    document.getElementById('notes-form').addEventListener('submit', handleNotesFormSubmit);
    document.getElementById('cancel-notes-btn').addEventListener('click', () => closeModal('notes-modal'));
    
    document.getElementById('holdings-content').addEventListener('click', (e) => {
        const sortHeader = e.target.closest('[data-sort-key]');
        if (sortHeader) {
            const newSortKey = sortHeader.dataset.sortKey;
            const { holdingsSort, holdings } = getState();
            let newOrder = 'desc';
            if (holdingsSort.key === newSortKey && holdingsSort.order === 'desc') {
                newOrder = 'asc';
            }
            setState({ holdingsSort: { key: newSortKey, order: newOrder } });
            renderHoldingsTable(holdings);
            return;
        }
        const notesBtn = e.target.closest('.open-notes-btn');
        if (notesBtn) {
            openModal('notes-modal', false, { symbol: notesBtn.dataset.symbol });
            return;
        }
    });

    document.getElementById('tabs').addEventListener('click', (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            if (tabName === 'dividends') {
                loadAndShowDividends();
            } else if (tabName === 'transactions') {
                renderTransactionsTable();
            }
        }
    });

    document.getElementById('dividends-tab').addEventListener('click', (e) => {
        const bulkConfirmBtn = e.target.closest('#bulk-confirm-dividends-btn');
        if (bulkConfirmBtn) { handleBulkConfirm(); return; }
        const editBtn = e.target.closest('.edit-dividend-btn');
        if (editBtn) { openModal('dividend-modal', true, { id: editBtn.dataset.id }); return; }
        const confirmBtn = e.target.closest('.confirm-dividend-btn');
        if (confirmBtn) { openModal('dividend-modal', false, { index: confirmBtn.dataset.index }); return; }
        const deleteBtn = e.target.closest('.delete-dividend-btn');
        if (deleteBtn) { handleDeleteDividend(deleteBtn); }
    });
     document.getElementById('dividends-tab').addEventListener('change', (e) => {
        if (e.target.id === 'dividend-symbol-filter') {
            setState({ dividendFilter: e.target.value });
            const { pendingDividends, confirmedDividends } = getState();
            renderDividendsManagementTab(pendingDividends, confirmedDividends);
        }
    });
    
    document.getElementById('dividend-form').addEventListener('submit', handleDividendFormSubmit);
    document.getElementById('cancel-dividend-btn').addEventListener('click', () => closeModal('dividend-modal'));
    document.getElementById('dividend-history-modal').addEventListener('click', (e) => {
        if (e.target.closest('#close-dividend-history-btn') || !e.target.closest('#dividend-history-content')) {
            closeModal('dividend-history-modal');
        }
    });
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);

    // 【修改】恢復原本的獨立事件監聽結構，並為新圖表複製此模式
    const twrControls = document.getElementById('twr-chart-controls');
    if (twrControls) {
        twrControls.addEventListener('click', (e) => {
            const btn = e.target.closest('.chart-range-btn');
            if (btn) handleChartRangeChange('twr', btn.dataset.range);
        });
        twrControls.addEventListener('change', (e) => {
            if (e.target.matches('.chart-date-input')) {
                const startInput = twrControls.querySelector('#twr-start-date');
                const endInput = twrControls.querySelector('#twr-end-date');
                if (startInput && endInput && startInput.value && endInput.value) {
                    twrControls.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                    handleChartRangeChange('twr', 'custom', startInput.value, endInput.value);
                }
            }
        });
    }

    const assetControls = document.getElementById('asset-chart-controls');
    if (assetControls) {
        assetControls.addEventListener('click', (e) => {
            const btn = e.target.closest('.chart-range-btn');
            if (btn) handleChartRangeChange('asset', btn.dataset.range);
        });
        assetControls.addEventListener('change', (e) => {
            if (e.target.matches('.chart-date-input')) {
                const startInput = assetControls.querySelector('#asset-start-date');
                const endInput = assetControls.querySelector('#asset-end-date');
                if (startInput && endInput && startInput.value && endInput.value) {
                    assetControls.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                    handleChartRangeChange('asset', 'custom', startInput.value, endInput.value);
                }
            }
        });
    }
    
    // 【新增】為淨利圖表複製完全相同的、獨立的處理模式
    const netProfitControls = document.getElementById('net-profit-chart-controls');
    if (netProfitControls) {
        netProfitControls.addEventListener('click', (e) => {
            const btn = e.target.closest('.chart-range-btn');
            // 【修正】將 'netProfit' 改為 'net-profit' 以匹配 HTML 的 ID
            if (btn) handleChartRangeChange('net-profit', btn.dataset.range);
        });
        netProfitControls.addEventListener('change', (e) => {
            if (e.target.matches('.chart-date-input')) {
                const startInput = netProfitControls.querySelector('#net-profit-start-date');
                const endInput = netProfitControls.querySelector('#net-profit-end-date');
                if (startInput && endInput && startInput.value && endInput.value) {
                    netProfitControls.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                    // 【修正】將 'netProfit' 改為 'net-profit' 以匹配 HTML 的 ID
                    handleChartRangeChange('net-profit', 'custom', startInput.value, endInput.value);
                }
            }
        });
    }
}

export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");
    initializeAssetChart();
    initializeTwrChart();
    initializeNetProfitChart();
    
    // 【修改】使用 setTimeout 來確保 DOM 元素都已渲染完成
    setTimeout(() => {
        setupMainAppEventListeners();
        lucide.createIcons();
    }, 0);

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
