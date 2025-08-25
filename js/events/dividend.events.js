// =========================================================================================
// == 配息事件處理模듈 (dividend.events.js) v2.0 - Fix Circular Dependency
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, executeApiAction } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';

// ========================= 【核心修改 - 開始】 =========================

/**
 * 【函式移入】載入配息數據並渲染UI
 * 此函式從 main.js 移入，以打破循環依賴
 */
export async function loadAndShowDividends() {
    // 檢查 state 中是否已有數據，若有則直接渲染
    const { pendingDividends, confirmedDividends } = getState();
    if (pendingDividends && confirmedDividends) {
         renderDividendsManagementTab(pendingDividends, confirmedDividends);
         return;
    }

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
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？系統將套用預設稅率與發放日期。`, () => {
        executeApiAction('bulk_confirm_all_dividends', { pendingDividends }, {
            loadingText: '正在批次確認配息...',
            successMessage: '所有待確認配息已處理完畢！'
        }).then(() => {
            // 操作成功後，呼叫此模組內的刷新函式
            return loadAndShowDividends();
        }).catch(error => {
            console.error("批次確認配息最終失敗:", error);
        });
    });
}

async function handleDividendFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('dividend-id').value;
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
    if (id) { dividendData.id = id; }
    
    const { closeModal } = await import('../ui/modals.js');
    closeModal('dividend-modal');

    executeApiAction('save_user_dividend', dividendData, {
        loadingText: '正在儲存配息紀錄...',
        successMessage: '配息紀錄已成功儲存！'
    }).then(() => {
        // 操作成功後，呼叫此模組內的刷新函式
        return loadAndShowDividends();
    }).catch(error => {
        console.error("儲存配息紀錄最終失敗:", error);
    });
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要刪除這筆已確認的配息紀錄嗎？', () => {
        executeApiAction('delete_user_dividend', { dividendId }, {
            loadingText: '正在刪除配息紀錄...',
            successMessage: '配息紀錄已成功刪除！'
        }).then(() => {
            // 操作成功後，呼叫此模組內的刷新函式
            return loadAndShowDividends();
        }).catch(error => {
            console.error("刪除配息紀錄最終失敗:", error);
        });
    });
}
// ========================= 【核心修改 - 結束】 =========================

export function initializeDividendEventListeners() {
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

    document.getElementById('dividends-tab').addEventListener('change', (e) => {
        if (e.target.id === 'dividend-symbol-filter') {
            setState({ dividendFilter: e.target.value });
            const { pendingDividends, confirmedDividends } = getState();
            renderDividendsManagementTab(pendingDividends, confirmedDividends);
        }
    });
    
    document.getElementById('dividend-form').addEventListener('submit', handleDividendFormSubmit);
    document.getElementById('cancel-dividend-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('dividend-modal');
    });

    document.getElementById('dividend-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.target.matches('textarea')) {
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
