// =========================================================================================
// == 拆股事件處理模組 (split.events.js) v3.1 - Centralized Refresh
// =========================================================================================

import { apiRequest } from '../api.js';
import { showNotification } from '../ui/notifications.js';

// ========================= 【核心修改 - 開始】 =========================
// 導入全局的、統一的刷新函式
import { refreshAllStagedViews } from '../app.js';
// ========================= 【核心修改 - 結束】 =========================

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('這筆拆股紀錄將被標記為待刪除，在您點擊「全部提交」後才會真正刪除。確定嗎？', async () => {
        const change = {
            op: 'DELETE',
            entity: 'split',
            payload: { id: splitId }
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

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const splitData = {
        date: document.getElementById('split-date').value,
        symbol: document.getElementById('split-symbol').value.toUpperCase().trim(),
        ratio: parseFloat(document.getElementById('split-ratio').value)
    };

    if (!splitData.symbol || isNaN(splitData.ratio) || splitData.ratio <= 0) {
        showNotification('error', '請填寫所有欄位並確保比例大於0。');
        return;
    }
    
    const { closeModal } = await import('../ui/modals.js');
    closeModal('split-modal');
    
    const change = {
        op: 'CREATE',
        entity: 'split',
        payload: splitData
    };

    try {
        await apiRequest('stage_change', change);
        showNotification('info', `拆股事件已加入暫存區。`);
        await refreshAllStagedViews(); // <--- 使用全局刷新
    } catch (error) {
        showNotification('error', `操作失敗: ${error.message}`);
    }
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

export function initializeSplitEventListeners() {
    const splitsTab = document.getElementById('splits-tab');
    if (splitsTab) {
        splitsTab.addEventListener('click', async (e) => { 
            const addBtn = e.target.closest('#add-split-btn');
            if (addBtn) {
                const { openModal } = await import('../ui/modals.js');
                openModal('split-modal');
                return;
            }
            const deleteBtn = e.target.closest('.delete-split-btn');
            if(deleteBtn) return handleDeleteSplit(deleteBtn);

            const revertBtn = e.target.closest('.revert-change-btn');
            if(revertBtn) return handleRevertChange(revertBtn);
        });
    }
    
    document.getElementById('split-form').addEventListener('submit', handleSplitFormSubmit);
    document.getElementById('cancel-split-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('split-modal');
    });

    document.getElementById('split-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('save-split-btn').click();
        }
    });
}