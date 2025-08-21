// =========================================================================================
// == 配息事件處理模組 (dividend.events.js) v3.0 - ATLAS-COMMIT Architecture
// == 職責：處理所有與配息管理分頁相關的用戶互動事件。
// =========================================================================================

import { getState, setState } from '../state.js';
// [核心修改] 引入新的 API 函式
import { apiRequest, stageChange } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';
import { loadAndShowDividends } from '../main.js'; // 維持用於刷新視圖

// --- Private Functions ---

// 批次確認功能在新架構下需要重新設計，暫時註解或後續改造
// async function handleBulkConfirm() { ... }

async function handleDividendFormSubmit(e) {
    e.preventDefault();
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
    
    const { closeModal } = await import('../ui/modals.js');
    closeModal('dividend-modal');

    // [核心修改] 實現樂觀更新與暫存
    const op = isEditing ? 'UPDATE' : 'CREATE';
    
    // 1. 立即在前端模擬 (因為沒有獨立暫存視圖，此處的樂觀更新較為困難，暫時以提示為主)
    showNotification('info', `配息紀錄 ${dividendData.symbol} 已加入待辦${isEditing ? '修改' : '新增'}。`);
    
    // 2. 在背景將「新增/編輯意圖」提交到暫存區
    try {
        await stageChange({
            op: op,
            entity: 'dividend', // 實體類型為 'dividend'
            payload: dividendData
        });
        // 成功後，可以考慮刷新一個能顯示 dividend 暫存態的視圖
        // 由於沒有暫存視圖，我們在提交成功後，可以簡單地再次載入配息管理頁面
        // 這會讓使用者感覺到操作被「受理」了
        await loadAndShowDividends(); 
    } catch (error) {
        showNotification('error', `${isEditing ? '編輯' : '新增'}操作暫存失敗。`);
    }
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { confirmedDividends } = getState();
    const dividendToDelete = confirmedDividends.find(d => d.id === dividendId);
    if (!dividendToDelete) return;

    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('您確定要將此已確認的配息紀錄加入待辦刪除列表嗎？', async () => {
        // 1. 樂觀更新 (以提示為主)
        showNotification('info', `配息紀錄 ${dividendToDelete.symbol} 已加入待辦刪除。`);
        
        // 2. 在背景將「刪除意圖」提交到暫存區
        try {
            await stageChange({
                op: 'DELETE',
                entity: 'dividend',
                payload: { id: dividendId }
            });
            await loadAndShowDividends();
        } catch (error) {
            showNotification('error', '刪除操作暫存失敗。');
        }
    });
}

// --- Public Function ---

export function initializeDividendEventListeners() {
    // 監聽配息管理分頁內的所有互動
    document.getElementById('dividends-tab').addEventListener('click', async (e) => {
        // bulk_confirm_all_dividends API 已被棄用，需要新的工作流
        // const bulkConfirmBtn = e.target.closest('#bulk-confirm-dividends-btn');
        // if (bulkConfirmBtn) { handleBulkConfirm(); return; }
        
        const editBtn = e.target.closest('.edit-dividend-btn');
        if (editBtn) {
            const { openModal } = await import('../ui/modals.js');
            openModal('dividend-modal', true, { id: editBtn.dataset.id });
            return;
        }

        const confirmBtn = e.target.closest('.confirm-dividend-btn');
        if (confirmBtn) {
            const { openModal } = await import('../ui/modals.js');
            openModal('dividend-modal', false, { index: confirmBtn.dataset.index });
            return;
        }

        const deleteBtn = e.target.closest('.delete-dividend-btn');
        if (deleteBtn) {
            handleDeleteDividend(deleteBtn);
        }
    });

    // 監聽配息分頁中的股票篩選器
    document.getElementById('dividends-tab').addEventListener('change', (e) => {
        if (e.target.id === 'dividend-symbol-filter') {
            setState({ dividendFilter: e.target.value });
            const { pendingDividends, confirmedDividends } = getState();
            renderDividendsManagementTab(pendingDividends, confirmedDividends);
        }
    });
    
    // 監聽配息表單的提交與取消
    document.getElementById('dividend-form').addEventListener('submit', handleDividendFormSubmit);
    document.getElementById('cancel-dividend-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('dividend-modal');
    });
    document.getElementById('dividend-history-modal').addEventListener('click', async (e) => {
        if (e.target.closest('#close-dividend-history-btn') || !e.target.closest('#dividend-history-content')) {
            const { closeModal } = await import('../ui/modals.js');
            closeModal('dividend-history-modal');
        }
    });
}
