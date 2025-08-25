// =========================================================================================
// == 配息事件處理模組 (dividend.events.js) v3.1 - Centralized Refresh
// == 職責：處理所有與配息管理分頁相關的用戶互動事件。
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';

// ========================= 【核心修改 - 開始】 =========================
// 導入全局的、統一的刷新函式
import { refreshAllStagedViews } from '../app.js';
// ========================= 【核心修改 - 結束】 =========================

async function handleBulkConfirm() {
    const { pendingDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？此操作將加入暫存區。`, async () => {
        try {
            await apiRequest('bulk_confirm_all_dividends', { pendingDividends });
            showNotification('info', `${pendingDividends.length} 筆配息已加入暫存區。`);
            setState({ pendingDividends: [] });
            await refreshAllStagedViews(); // <--- 使用全局刷新
        } catch (error) {
            showNotification('error', `批次確認失敗: ${error.message}`);
        }
    });
}

async function handleDividendFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('dividend-id').value;
    const isEditing = !!id;
    
    const dividendData = {
        id: id || null,
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

    const { closeModal } = await import('../ui/modals.js');
    closeModal('dividend-modal');

    const change = {
        op: isEditing ? 'UPDATE' : 'CREATE',
        entity: 'dividend',
        payload: dividendData
    };

    try {
        await apiRequest('stage_change', change);
        showNotification('info', `配息變更已加入暫存區。`);
        await refreshAllStagedViews(); // <--- 使用全局刷新
    } catch (error) {
        showNotification('error', `操作失敗: ${error.message}`);
    }
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('這筆配息將被標記為待刪除，在您點擊「全部提交」後才會真正刪除。確定嗎？', async () => {
        const change = {
            op: 'DELETE',
            entity: 'dividend',
            payload: { id: dividendId }
        };
        try {
            await apiRequest('stage_change', change);
            showNotification('info', `刪除操作已加入暫存區。`);
            await refreshAllStagedViews(); // <--- 使用全局刷新
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        }
    });
}

async function handleRevertChange(button) {
    const changeId = button.dataset.changeId;
    try {
        await apiRequest('revert_staged_change', { changeId });
        showNotification('success', '操作已成功復原。');
        await refreshAllStagedViews(); // <--- 使用全局刷新
    } catch (error) {
        showNotification('error', `復原失敗: ${error.message}`);
    }
}

export function initializeDividendEventListeners() {
    document.getElementById('dividends-tab').addEventListener('click', async (e) => {
        if (e.target.closest('#bulk-confirm-dividends-btn')) return handleBulkConfirm();
        if (e.target.closest('.edit-dividend-btn')) {
            const { openModal } = await import('../ui/modals.js');
            const { confirmedDividends } = getState();
            const record = confirmedDividends.find(d => d.id === e.target.closest('.edit-dividend-btn').dataset.id);
            if (record) return openModal('dividend-modal', true, record);
        }
        if (e.target.closest('.confirm-dividend-btn')) {
            const { openModal } = await import('../ui/modals.js');
            return openModal('dividend-modal', false, { index: e.target.closest('.confirm-dividend-btn').dataset.index });
        }
        if (e.target.closest('.delete-dividend-btn')) return handleDeleteDividend(e.target.closest('.delete-dividend-btn'));
        if (e.target.closest('.revert-change-btn')) return handleRevertChange(e.target.closest('.revert-change-btn'));
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
