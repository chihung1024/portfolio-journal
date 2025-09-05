// =========================================================================================
// == 配息事件處理模組 (dividend.events.js) v2.1 - Robust Delete Logic
// =========================================================================================

import { getState, setState } from '../state.js';
import { stagingService } from '../staging.service.js'; // 【核心修改】
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';

/**
 * 【新增】操作成功存入暫存區後，更新 UI
 */
async function handleStagingSuccess() {
    showNotification('info', '操作已暫存。點擊「全部提交」以同步至雲端。');
    
    // 立即重新渲染配息列表以顯示暫存狀態
    const { pendingDividends, confirmedDividends } = getState();
    await renderDividendsManagementTab(pendingDividends, confirmedDividends);
}


async function handleBulkConfirm() {
    // 注意：批次確認是一個特殊操作，它本身就是一個批次，因此我們維持直接呼叫 API
    // 暫存區主要處理單筆的 CUD 操作
    const { pendingDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }
    const { showConfirm } = await import('../ui/modals.js');
    const { executeApiAction } = await import('../api.js');
    const { loadAndShowDividends } = await import('../main.js');

    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？此操作將會直接提交至後端。`, () => {
        executeApiAction('bulk_confirm_all_dividends', { pendingDividends }, {
            loadingText: '正在批次確認配息...',
            successMessage: '所有待確認配息已處理完畢！'
        }).then(() => {
            return loadAndShowDividends();
        }).catch(error => {
            console.error("批次確認配息最終失敗:", error);
        });
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
    
    const { closeModal } = await import('../ui/modals.js');
    closeModal('dividend-modal');

    // 【核心修改】將操作寫入暫存區
    try {
        if (isEditing) {
            dividendData.id = id;
            await stagingService.addAction('UPDATE', 'dividend', dividendData);
        } else {
            // 對於從 "待確認" 轉來的配息，我們視為 "新增" 一筆已確認配息
            dividendData.id = `temp_dividend_${Date.now()}`;
            await stagingService.addAction('CREATE', 'dividend', dividendData);
        }
        handleStagingSuccess();
    } catch (error) {
        showNotification('error', `暫存配息操作失敗: ${error.message}`);
    }
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');

    // ========================= 【核心修改 - 開始】 =========================
    // 統一邏輯：在刪除前，先合併 state 與暫存區的數據，確保拿到最新版本的物件。
    const { confirmedDividends } = getState();
    const stagedActions = await stagingService.getStagedActions();
    const stagedDividends = stagedActions
        .filter(a => a.entity === 'dividend' && a.type !== 'DELETE')
        .map(a => a.payload);

    let combined = [...confirmedDividends];
    stagedDividends.forEach(stagedDiv => {
        const index = combined.findIndex(d => d.id === stagedDiv.id);
        if (index > -1) {
            combined[index] = { ...combined[index], ...stagedDiv };
        } else {
            combined.push(stagedDiv);
        }
    });

    const dividendToDelete = combined.find(d => d.id === dividendId);
    // ========================= 【核心修改 - 結束】 =========================

    if (!dividendToDelete) {
        showNotification('error', '找不到要刪除的配息紀錄。');
        return;
    }

    showConfirm('確定要刪除這筆已確認的配息紀錄嗎？此操作將被加入暫存區。', async () => {
        try {
            await stagingService.addAction('DELETE', 'dividend', dividendToDelete);
            handleStagingSuccess();
        } catch (error) {
            showNotification('error', `暫存刪除操作失敗: ${error.message}`);
        }
    });
}

// --- Public Function ---

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
