// =========================================================================================
// == 配息事件處理模듈 (dividend.events.js) v3.2 - Final Cleanup
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';
// 【修改】統一導入職責更清晰的全局刷新函式
import { refreshAllStagedViews } from '../main.js';

/**
 * 載入配息數據並渲染UI
 */
export async function loadAndShowDividends() {
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

/**
 * 處理批次確認所有待處理股利
 */
async function handleBulkConfirm() {
    const { pendingDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？變更將進入暫存區。`, async () => {
        const loadingOverlay = document.getElementById('loading-overlay');
        loadingOverlay.style.display = 'flex';
        try {
            for (const pending of pendingDividends) {
                const isTw = pending.symbol.toUpperCase().endsWith('.TW') || pending.symbol.toUpperCase().endsWith('.TWO');
                const taxRate = isTw ? 0 : 30;
                const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate / 100);

                const dividendData = {
                    symbol: pending.symbol,
                    ex_dividend_date: pending.ex_dividend_date,
                    pay_date: pending.ex_dividend_date.split('T')[0],
                    currency: pending.currency,
                    quantity_at_ex_date: pending.quantity_at_ex_date,
                    amount_per_share: pending.amount_per_share,
                    total_amount: totalAmount,
                    tax_rate: taxRate,
                    notes: '批次確認'
                };
                
                const change = { op: 'CREATE', entity: 'dividend', payload: dividendData };
                await apiRequest('stage_change', change);
            }
            showNotification('info', `${pendingDividends.length} 筆配息已全部加入暫存区。`);
            await refreshAllStagedViews(); // 【修改】統一呼叫
        } catch (error) {
            showNotification('error', `批次確認失敗: ${error.message}`);
        } finally {
            loadingOverlay.style.display = 'none';
        }
    });
}

/**
 * 處理配息表單提交 (新增或編輯)
 */
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

    const change = {
        op: isEditing ? 'UPDATE' : 'CREATE',
        entity: 'dividend',
        payload: dividendData
    };

    try {
        await apiRequest('stage_change', change);
        showNotification('info', `配息紀錄已加入暫存区。`);
        await refreshAllStagedViews(); // 【修改】統一呼叫
    } catch(error) {
        showNotification('error', `儲存失敗: ${error.message}`);
    }
}

/**
 * 處理刪除已確認的配息紀錄
 */
async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('此配息紀錄將被標記為待刪除，在您點擊「全部提交」後才會真正刪除。確定嗎？', async () => {
        const change = {
            op: 'DELETE',
            entity: 'dividend',
            payload: { dividendId } 
        };
        try {
            await apiRequest('stage_change', change);
            showNotification('info', `刪除配息操作已加入暫存區。`);
            await refreshAllStagedViews(); // 【修改】統一呼叫
        } catch(error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        }
    });
}

/**
 * 處理復原刪除配息按鈕點擊
 */
async function handleRevertDividendDelete(button) {
    const changeId = button.dataset.changeId;
    try {
        const result = await apiRequest('revert_staged_change', { changeId });
        if(result.success) {
            showNotification('success', '刪除操作已成功復原。');
            await refreshAllStagedViews(); // 【修改】統一呼叫
        }
    } catch (error) {
        showNotification('error', `復原失敗: ${error.message}`);
    }
}

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
            return;
        }
        const revertBtn = e.target.closest('.revert-delete-dividend-btn');
        if (revertBtn) {
            handleRevertDividendDelete(revertBtn);
            return;
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