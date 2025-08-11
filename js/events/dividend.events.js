// =========================================================================================
// == 配息事件處理模組 (dividend.events.js)
// == 職責：處理所有與配息管理分頁相關的用戶互動事件。
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, loadPortfolioData } from '../api.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';
// 【修正】: 從 main.js 引入 loadAndShowDividends，因為它是跨模組調用的
import { loadAndShowDividends } from '../main.js';

// --- Private Functions ---

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

// --- Public Function ---

export function initializeDividendEventListeners() {
    // 監聽配息管理分頁內的所有互動
    document.getElementById('dividends-tab').addEventListener('click', (e) => {
        const bulkConfirmBtn = e.target.closest('#bulk-confirm-dividends-btn');
        if (bulkConfirmBtn) {
            handleBulkConfirm();
            return;
        }
        const editBtn = e.target.closest('.edit-dividend-btn');
        if (editBtn) {
            openModal('dividend-modal', true, { id: editBtn.dataset.id });
            return;
        }
        const confirmBtn = e.target.closest('.confirm-dividend-btn');
        if (confirmBtn) {
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
    document.getElementById('cancel-dividend-btn').addEventListener('click', () => closeModal('dividend-modal'));
    document.getElementById('dividend-history-modal').addEventListener('click', (e) => {
        if (e.target.closest('#close-dividend-history-btn') || !e.target.closest('#dividend-history-content')) {
            closeModal('dividend-history-modal');
        }
    });
}
