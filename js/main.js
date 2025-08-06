// =========================================================================================
// == 主程式進入點 (main.js)
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
    renderHoldingsTable // [修改] 引入 renderHoldingsTable
} from './ui.js';

// --- 事件處理函式 ---

function handleEdit(e) {
    const { transactions } = getState();
    const txId = e.target.dataset.id;
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) return;
    openModal('transaction-modal', true, transaction);
}

async function handleDelete(e) {
    const txId = e.target.dataset.id;
    showConfirm('確定要刪除這筆交易紀錄嗎？', async () => {
        try {
            await apiRequest('delete_transaction', { txId });
            showNotification('success', '交易紀錄已刪除！');
            await loadPortfolioData();
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        }
    });
}

async function handleDeleteSplit(e) {
    const splitId = e.target.dataset.id;
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
    }
}

async function handleUpdateBenchmark() {
    const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
    if (!newBenchmark) { showNotification('error', '請輸入 Benchmark 的股票代碼。'); return; }
    try {
        showNotification('info', `正在更新 Benchmark 並重算...`);
        await apiRequest('update_benchmark', { benchmarkSymbol: newBenchmark });
        await loadPortfolioData();
    } catch(error) {
        showNotification('error', `更新 Benchmark 失敗: ${error.message}`);
    }
}

// [新增] 處理筆記儲存
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
        
        // 更新本地 state 並重新渲染持股列表以顯示提示
        const { stockNotes } = getState();
        stockNotes[noteData.symbol] = { ...stockNotes[noteData.symbol], ...noteData };
        setState({ stockNotes });
        
        // 重新渲染持股列表以更新價格提示顏色
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


/**
 * 集中設定所有 DOM 元素的事件監聽器
 */
function setupEventListeners() {
    // 認證相關
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // 交易相關
    document.getElementById('add-transaction-btn').addEventListener('click', () => openModal('transaction-modal'));
    document.getElementById('transaction-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));
    document.getElementById('transactions-table-body').addEventListener('click', (e) => { 
        if (e.target.closest('.edit-btn')) { handleEdit(e.target.closest('.edit-btn')); } 
        if (e.target.closest('.delete-btn')) { handleDelete(e.target.closest('.delete-btn')); } 
    });

    // 拆股相關
    document.getElementById('manage-splits-btn').addEventListener('click', () => openModal('split-modal'));
    document.getElementById('split-form').addEventListener('submit', handleSplitFormSubmit);
    document.getElementById('cancel-split-btn').addEventListener('click', () => closeModal('split-modal'));
    document.getElementById('splits-table-body').addEventListener('click', (e) => { if (e.target.closest('.delete-split-btn')) { handleDeleteSplit(e.target.closest('.delete-split-btn')); } });
    
    // Benchmark
    document.getElementById('update-benchmark-btn').addEventListener('click', handleUpdateBenchmark);

    // [新增] 筆記相關
    document.getElementById('notes-form').addEventListener('submit', handleNotesFormSubmit);
    document.getElementById('cancel-notes-btn').addEventListener('click', () => closeModal('notes-modal'));
    // 使用事件委派來處理動態產生的筆記按鈕
    document.getElementById('holdings-content').addEventListener('click', (e) => {
        const btn = e.target.closest('.open-notes-btn');
        if (btn) {
            const symbol = btn.dataset.symbol;
            openModal('notes-modal', false, { symbol });
        }
    });

    // 通用 UI
    document.getElementById('tabs').addEventListener('click', (e) => { e.preventDefault(); if (e.target.matches('.tab-item')) { switchTab(e.target.dataset.tab); } });
    document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirm);
    document.getElementById('confirm-ok-btn').addEventListener('click', () => { 
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); } 
        hideConfirm(); 
    });
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);
}

// --- 應用程式初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loading-overlay').style.display = 'flex';
    
    initializeChart();
    initializeTwrChart();
    setupEventListeners();
    initializeAuth(); 
    
    lucide.createIcons();
});
