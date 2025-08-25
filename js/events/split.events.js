// =========================================================================================
// == 拆股事件處理模組 (split.events.js) v2.2 - Fix UI Refresh
// =========================================================================================

import { executeApiAction } from '../api.js';
import { showNotification } from '../ui/notifications.js';

// ========================= 【核心修改 - 開始】 =========================
// 導入全局刷新函式
import { loadInitialDashboard } from '../app.js';
// ========================= 【核心修改 - 結束】 =========================

// --- Private Functions ---

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要刪除這個拆股事件嗎？此操作會觸發全局重算。 ', async () => {
        // ========================= 【核心修改 - 開始】 =========================
        try {
            await executeApiAction('delete_split', { splitId }, {
                loadingText: '正在刪除拆股事件並重算績效...',
                successMessage: '拆股事件已成功刪除！'
            });
            await loadInitialDashboard();
        } catch (error) {
            console.error("刪除拆股事件最終失敗:", error);
        }
        // ========================= 【核心修改 - 結束】 =========================
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
    
    // ========================= 【核心修改 - 開始】 =========================
    try {
        await executeApiAction('add_split', splitData, {
            loadingText: '正在新增拆股事件並重算績效...',
            successMessage: '拆股事件已成功新增！'
        });
        await loadInitialDashboard();
    } catch (error) {
        console.error("新增拆股事件最終失敗:", error);
    }
    // ========================= 【核心修改 - 結束】 =========================
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