// =========================================================================================
// == 配息事件處理模組 (dividend.events.js) v2.0 - 整合暫存區
// =========================================================================================

import { getState, setState } from '../state.js';
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';
import { stagingService } from '../staging.service.js';
import { updateStagedCountBadge } from './staging.events.js';

// --- Private Functions ---

async function handleBulkConfirm() {
    const { pendingDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`您確定要將 ${pendingDividends.length} 筆配息紀錄加入暫存區嗎？`, async () => {
        try {
            for (const dividend of pendingDividends) {
                const tempId = `temp_${self.crypto.randomUUID()}`;
                await stagingService.addAction({
                    type: 'CREATE', 
                    entity: 'DIVIDEND',
                    payload: { ...dividend, id: tempId, status: 'CONFIRMED' } // 將待確認配息轉為新增操作
                });
            }
            showNotification('success', `${pendingDividends.length} 筆配息已加入暫存區。`);
            await updateStagedCountBadge();
            renderDividendsManagementTab();
        } catch (error) {
            console.error("Failed to stage bulk confirm dividends:", error);
            showNotification('error', '批次加入暫存區失敗。');
        }
    });
}

async function handleDividendFormSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('dividend-form');
    const id = form.querySelector('#dividend-id').value;
    const isEditing = !!id;

    const dividendData = {
        symbol: form.querySelector('#dividend-symbol').value,
        date: form.querySelector('#dividend-date').value,
        amount: parseFloat(form.querySelector('#dividend-amount').value),
        // 其他欄位根據您的表單添加
    };

    if (!dividendData.symbol || !dividendData.date || isNaN(dividendData.amount)) {
        showNotification('error', '請填寫所有必填欄位。');
        return;
    }

    const { closeModal } = await import('../ui/modals.js');
    closeModal('dividend-modal');

    try {
        if (isEditing) {
            await stagingService.addAction({
                type: 'UPDATE',
                entity: 'DIVIDEND',
                payload: { id, ...dividendData }
            });
            showNotification('success', '配息編輯操作已加入暫存區。');
        } else {
            const tempId = `temp_${self.crypto.randomUUID()}`;
            await stagingService.addAction({
                type: 'CREATE',
                entity: 'DIVIDEND',
                payload: { id: tempId, ...dividendData }
            });
            showNotification('success', '配息新增操作已加入暫存區。');
        }
        await updateStagedCountBadge();
        renderDividendsManagementTab();
    } catch (error) {
        console.error("Failed to stage dividend action:", error);
        showNotification('error', '操作加入暫存區失敗。');
    }
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要將這筆配息的刪除操作加入暫存區嗎？', async () => {
        try {
            await stagingService.addAction({
                type: 'DELETE',
                entity: 'DIVIDEND',
                payload: { id: dividendId }
            });
            showNotification('success', '刪除操作已加入暫存區。');
            await updateStagedCountBadge();
            renderDividendsManagementTab();
        } catch (error) {
            console.error("Failed to stage delete dividend action:", error);
            showNotification('error', '刪除操作加入暫存區失敗。');
        }
    });
}

// --- Public Function ---

export function initializeDividendEventListeners() {
    const dividendsTab = document.getElementById('dividends-tab');
    if (!dividendsTab) return;

    dividendsTab.addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        if (button.id === 'bulk-confirm-dividends-btn') {
            handleBulkConfirm();
        } else if (button.classList.contains('edit-dividend-btn')) {
            const { openModal } = await import('../ui/modals.js');
            const { confirmedDividends } = getState();
            const dividend = confirmedDividends.find(d => d.id === button.dataset.id);
            openModal('dividend-modal', dividend);
        } else if (button.classList.contains('confirm-dividend-btn')) {
            const { openModal } = await import('../ui/modals.js');
            const { pendingDividends } = getState();
            const dividend = pendingDividends[button.dataset.index];
            openModal('dividend-modal', dividend); // Open modal with pending data to confirm
        } else if (button.classList.contains('delete-dividend-btn')) {
            handleDeleteDividend(button);
        }
    });

    const dividendForm = document.getElementById('dividend-form');
    if (dividendForm) {
        dividendForm.addEventListener('submit', handleDividendFormSubmit);
    }
}
