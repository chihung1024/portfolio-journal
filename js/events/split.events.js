// =========================================================================================
// == 拆股事件處理模組 (split.events.js) v3.0 - 整合暫存區
// =========================================================================================

import { showNotification } from '../ui/notifications.js';
import { renderSplitsTab } from '../ui/components/splits.ui.js';
import { stagingService } from '../staging.service.js';
import { updateStagedCountBadge } from './staging.events.js';

// --- Private Functions ---

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要將這個拆股事件的刪除操作加入暫存區嗎？', async () => {
        try {
            await stagingService.addAction({
                type: 'DELETE',
                entity: 'SPLIT',
                payload: { id: splitId }
            });
            showNotification('success', '刪除操作已加入暫存區。');
            await updateStagedCountBadge();
            renderSplitsTab();
        } catch (error) {
            console.error("Failed to stage delete split action:", error);
            showNotification('error', '刪除操作加入暫存區失敗。');
        }
    });
}

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('split-form');
    const splitData = {
        date: form.querySelector('#split-date').value,
        symbol: form.querySelector('#split-symbol').value.toUpperCase().trim(),
        from: parseFloat(form.querySelector('#split-from').value),
        to: parseFloat(form.querySelector('#split-to').value)
    };

    if (!splitData.symbol || !splitData.date || isNaN(splitData.from) || isNaN(splitData.to) || splitData.from <= 0 || splitData.to <= 0) {
        showNotification('error', '請填寫所有欄位並確保比例數字大於0。');
        return;
    }

    const { closeModal } = await import('../ui/modals.js');
    closeModal('split-modal');

    try {
        const tempId = `temp_${self.crypto.randomUUID()}`;
        await stagingService.addAction({
            type: 'CREATE',
            entity: 'SPLIT',
            payload: { id: tempId, ...splitData }
        });
        showNotification('success', '新增拆股事件已加入暫存區。');
        await updateStagedCountBadge();
        renderSplitsTab();
    } catch (error) {
        console.error("Failed to stage create split action:", error);
        showNotification('error', '新增操作加入暫存區失敗。');
    }
}

// --- Public Function ---

export function initializeSplitEventListeners() {
    const splitsTab = document.getElementById('splits-tab');
    if (splitsTab) {
        splitsTab.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            if (button.id === 'add-split-btn') {
                const { openModal } = await import('../ui/modals.js');
                openModal('split-modal');
            } else if (button.classList.contains('delete-split-btn')) {
                handleDeleteSplit(button);
            }
        });
    }

    const splitForm = document.getElementById('split-form');
    if (splitForm) {
        splitForm.addEventListener('submit', handleSplitFormSubmit);
    }
}
