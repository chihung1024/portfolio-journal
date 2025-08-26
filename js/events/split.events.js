// =========================================================================================
// == 拆股事件處理模組 (split.events.js) v3.0.0 - 整合操作隊列
// =========================================================================================

import { addToQueue } from '../op_queue_manager.js'; // 【新增】引入操作隊列管理器
import { showNotification } from '../ui/notifications.js';
import { renderSplitsTable } from '../ui/components/splits.ui.js'; // 【新增】引入渲染函式
// 【移除】不再需要直接呼叫後端
// import { executeApiAction } from '../api.js';

// --- Private Functions ---

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要刪除這個拆股事件嗎？此操作將被暫存，點擊「同步變更」後才會生效。', () => {
        // 【核心修改】將操作加入隊列
        const success = addToQueue('DELETE', 'split', { splitId });
        
        if (success) {
            showNotification('info', '拆股事件已標記為刪除。點擊同步按鈕以儲存變更。');
            // 立即使用更新後的 state 重新渲染 UI
            renderSplitsTable();
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
    
    // 【核心修改】將操作加入隊列
    const success = addToQueue('CREATE', 'split', splitData);

    if (success) {
        showNotification('info', '新拆股事件已暫存。點擊同步按鈕以儲存。');
        // 立即使用更新後的 state 重新渲染 UI
        renderSplitsTable();
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