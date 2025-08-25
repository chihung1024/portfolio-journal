// =========================================================================================
// == 配息事件處理模組 (dividend.events.js) v2.1 - Fix UI Refresh
// == 職責：處理所有與配息管理分頁相關的用戶互動事件。
// =========================================================================================

import { getState, setState } from '../state.js';
import { executeApiAction } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';
import { loadAndShowDividends, loadInitialDashboard } from '../app.js';

// --- Private Functions ---

async function handleBulkConfirm() {
    const { pendingDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？系統將套用預設稅率與發放日期。`, async () => {
        try {
            await executeApiAction('bulk_confirm_all_dividends', { pendingDividends }, {
                loadingText: '正在批次確認配息...',
                successMessage: '所有待確認配息已處理完畢！'
            });
            // 成功後，刷新配息管理分頁的內容
            await loadAndShowDividends();
        } catch (error) {
            console.error("批次確認配息最終失敗:", error);
        }
    });
}

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

    // ========================= 【核心修改 - 開始】 =========================
    try {
        await executeApiAction('save_user_dividend', dividendData, {
            loadingText: '正在儲存配息紀錄並重算績效...',
            successMessage: '配息紀錄已成功儲存！'
        });
        // 操作會觸發後端重算，因此需完整刷新儀表板
        await loadInitialDashboard();
    } catch (error) {
        console.error("儲存配息紀錄最終失敗:", error);
    }
    // ========================= 【核心修改 - 結束】 =========================
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要刪除這筆已確認的配息紀錄嗎？', async () => {
        // ========================= 【核心修改 - 開始】 =========================
        try {
            await executeApiAction('delete_user_dividend', { dividendId }, {
                loadingText: '正在刪除配息紀錄並重算績效...',
                successMessage: '配息紀錄已成功刪除！'
            });
            // 操作會觸發後端重算，因此需完整刷新儀表板
            await loadInitialDashboard();
        } catch (error) {
            console.error("刪除配息紀錄最終失敗:", error);
        }
        // ========================= 【核心修改 - 結束】 =========================
    });
}

// --- Public Function ---

export function initializeDividendEventListeners() {
    // 監聽配息管理分頁內的所有互動
    document.getElementById('dividends-tab').addEventListener('click', async (e) => {
        const bulkConfirmBtn = e.target.closest('#bulk-confirm-dividends-btn');
        if (bulkConfirmBtn) {
            handleBulkConfirm();
            return;
        }
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

    // 為配息表單增加 Enter 鍵監聽
    document.getElementById('dividend-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.target.matches('textarea')) { // 避免在多行備註欄位按 Enter 就送出
            e.preventDefault();
            document.getElementById('save-dividend-btn').click();
        }
    });
    
    document.getElementById('dividend-history-modal').addEventListener('click', async (e) => {
        if (e.target.closest('#close-dividend-history-btn') || !e.target.closest('#dividend-history-content')) {
            const { closeModal } = await import('../ui/modals.js');
            closeModal('dividend-history-modal');
        }
    });
}
