// =========================================================================================
// == 拆股事件處理模組 (split.events.js) v2.0 - UI Refinements
// =========================================================================================

import { executeApiAction } from '../api.js';
// import { openModal, closeModal, showConfirm } from '../ui/modals.js'; // 移除靜態導入
import { showNotification } from '../ui/notifications.js';

// --- Private Functions ---

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要刪除這個拆股事件嗎？', () => {
        executeApiAction('delete_split', { splitId }, {
            loadingText: '正在刪除拆股事件...',
            successMessage: '拆股事件已成功刪除！'
        }).catch(error => {
            console.error("刪除拆股事件最終失敗:", error);
        });
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
    
    executeApiAction('add_split', splitData, {
        loadingText: '正在新增拆股事件...',
        successMessage: '拆股事件已成功新增！'
    }).catch(error => {
        console.error("新增拆股事件最終失敗:", error);
    });
}

// --- Public Function ---

export function initializeSplitEventListeners() {
    // 【修改】將事件監聽器綁定到更具體的父元素上
    const splitsTab = document.getElementById('splits-tab');
    if (splitsTab) {
        splitsTab.addEventListener('click', async (e) => { 
            // 監聽 "新增拆股" 按鈕
            const addBtn = e.target.closest('#add-split-btn');
            if (addBtn) {
                const { openModal } = await import('../ui/modals.js');
                openModal('split-modal');
                return;
            }
            // 監聽 "刪除" 按鈕
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
}
