// =========================================================================================
// == 拆股事件處理模組 (split.events.js) v3.0 - 整合暫存區
// =========================================================================================

import { stagingService } from '../staging.service.js'; // 【核心修改】
import { showNotification } from '../ui/notifications.js';
import { renderSplitsTable } from '../ui/components/splits.ui.js'; // 【核心修改】

// --- Private Functions ---

/**
 * 【新增】操作成功存入暫存區後，更新 UI
 */
function handleStagingSuccess() {
    showNotification('info', '操作已暫存。點擊「全部提交」以同步至雲端。');
    // 立即重新渲染列表以顯示暫存狀態
    renderSplitsTable();
}

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要刪除這個拆股事件嗎？此操作將被加入暫存區。', async () => {
        try {
            await stagingService.addAction('DELETE', 'split', { id: splitId });
            handleStagingSuccess();
        } catch (error) {
            showNotification('error', `暫存刪除操作失敗: ${error.message}`);
        }
    });
}

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const splitData = {
        id: `temp_split_${Date.now()}`, // 【核心修改】給予一個臨時ID
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
    
    // 【核心修改】將操作寫入暫存區
    try {
        await stagingService.addAction('CREATE', 'split', splitData);
        handleStagingSuccess();
    } catch (error) {
        showNotification('error', `暫存新增操作失敗: ${error.message}`);
    }
}

// --- Public Function ---

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
            if(deleteBtn) {
                handleDeleteSplit(deleteBtn);
            }
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