// =========================================================================================
// == 主程式進入點 (main.js) v2.8.2 (修正版)
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, loadPortfolioData } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';
import { 
    initializeChart, 
    initializeTwrChart, 
    openModal, 
    closeModal, 
    showConfirm, 
    hideConfirm, 
    toggleOptionalFields, 
    showNotification,
    switchTab,
    renderHoldingsTable,
    renderDividendsManagementTab,
    openDividendHistoryModal,
} from './ui.js';

// --- 事件處理函式 (保持不變) ---

function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    openModal('transaction-modal', true, transaction);
}

async function handleDelete(button) {
    const txId = button.dataset.id;
    showConfirm('確定要刪除這筆交易紀錄嗎？', async () => {
        try {
            document.getElementById('loading-overlay').style.display = 'flex';
            await apiRequest('delete_transaction', { txId });
            showNotification('success', '交易紀錄已刪除！');
            await loadPortfolioData();
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        } finally {
            document.getElementById('loading-overlay').style.display = 'none';
        }
    });
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 儲存中...`;

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
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存';
        return;
    }

    try {
        const action = isEditing ? 'edit_transaction' : 'add_transaction';
        const payload = isEditing ? { txId, txData: transactionData } : transactionData;

        await apiRequest(action, payload);

        closeModal('transaction-modal');
        await loadPortfolioData();
        showNotification('success', isEditing ? '交易已更新！' : '交易已新增！');

    } catch (error) {
        console.error('Failed to save transaction:', error);
        showNotification('error', `儲存交易失敗: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存';
    }
}

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
        console.error('Failed to add split event:', error);
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
        
        const { stockNotes } = getState();
        stockNotes[noteData.symbol] = { ...stockNotes[noteData.symbol], ...noteData };
        setState({ stockNotes });
        
        const holdingsResponse = await apiRequest('get_data', {});
        const holdingsObject = (holdingsResponse.data.holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
        renderHoldingsTable(holdingsObject);

        showNotification('success', `${noteData.symbol} 的筆記已儲存！`);
    } catch (error) {
        console.error('Failed to save note:', error);
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
    if (isEditing) {
        dividendData.id = id;
    }

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

/**
 * [修改] 設置所有**非主內容**的事件監聽器
 */
function setupCommonEventListeners() {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirm);
    document.getElementById('confirm-ok-btn').addEventListener('click', () => { 
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); } 
        hideConfirm(); 
    });
}

/**
 * [新增] 只有在登入後，才設置主內容的事件監聽器
 */
function setupMainAppEventListeners() {
    document.getElementById('add-transaction-btn').addEventListener('click', () => openModal('transaction-modal'));
    document.getElementById('transaction-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));

    document.getElementById('transactions-table-body').addEventListener('click', (e) => {
        const editButton = e.target.closest('.edit-btn');
        if (editButton) {
            e.preventDefault(); handleEdit(editButton); return;
        }
        const deleteButton = e.target.closest('.delete-btn');
        if (deleteButton) {
            e.preventDefault(); handleDelete(deleteButton);
        }
    });

    // The 'manage-splits-btn' was removed in a previous step, but we add it back for completeness.
    // If you don't have this button, you can remove these lines.
    const manageSplitsBtn = document.getElementById('manage-splits-btn');
    if (manageSplitsBtn) {
        manageSplitsBtn.addEventListener('click', () => openModal('split-modal'));
    }
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
        const notesBtn = e.target.closest('.open-notes-btn');
        if (notesBtn) {
            const symbol = notesBtn.dataset.symbol;
            openModal('notes-modal', false, { symbol });
            return;
        }
        const dividendBtn = e.target.closest('.open-dividend-history-btn');
        if (dividendBtn) {
            const symbol = dividendBtn.dataset.symbol;
            openDividendHistoryModal(symbol);
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
            }
        }
    });

    document.getElementById('dividends-tab').addEventListener('click', (e) => {
        const bulkConfirmBtn = e.target.closest('#bulk-confirm-dividends-btn');
        if (bulkConfirmBtn) { handleBulkConfirm(); return; }

        const confirmBtn = e.target.closest('.confirm-dividend-btn');
        if (confirmBtn) { openModal('dividend-modal', false, { index: confirmBtn.dataset.index }); return; }
        
        const editBtn = e.target.closest('.edit-dividend-btn');
        if (editBtn) { openModal('dividend-modal', true, { index: editBtn.dataset.index }); return; }
        
        const deleteBtn = e.target.closest('.delete-dividend-btn');
        if (deleteBtn) { handleDeleteDividend(deleteBtn); }
    });
    
    document.getElementById('dividend-form').addEventListener('submit', handleDividendFormSubmit);
    document.getElementById('cancel-dividend-btn').addEventListener('click', () => closeModal('dividend-modal'));

    document.getElementById('dividend-history-modal').addEventListener('click', (e) => {
        if (e.target.closest('#close-dividend-history-btn') || !e.target.closest('#dividend-history-content')) {
            closeModal('dividend-history-modal');
        }
    });
    
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);
}

// --- 應用程式初始化 ---

/**
 * [新增] 主應用 UI 初始化函式，由 auth.js 呼叫
 * 使用 isAppInitialized 旗標確保只執行一次
 */
export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");
    
    initializeChart();
    initializeTwrChart();
    setupMainAppEventListeners();
    
    lucide.createIcons();
    
    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    // 頁面載入時，只設定通用事件監聽器並啟動認證流程
    setupCommonEventListeners();
    initializeAuth(); 
});
