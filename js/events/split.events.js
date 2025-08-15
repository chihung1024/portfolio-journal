// =========================================================================================
// == 拆股事件處理模組 (split.events.js)
// == 職責：處理所有與拆股事件相關的用戶互動事件。
// =========================================================================================

import { executeApiAction } from '../api.js'; // [核心修改] 改為導入新的高階函式
// 【核心修改】 showNotification 和 loadPortfolioData 不再需要直接導入
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js'; // showNotification 仍需用於表單驗證

// --- Private Functions ---

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    showConfirm('確定要刪除這個拆股事件嗎？', () => {
        // [核心修改] 使用 executeApiAction 處理所有後續邏輯
        executeApiAction('delete_split', { splitId }, {
            loadingText: '正在刪除拆股事件...',
            successMessage: '拆股事件已成功刪除！'
        }).catch(error => {
            // 如果 executeApiAction 失敗，錯誤會被自動處理（顯示通知）
            // 可以在這裡做一些額外的恢復 UI 的操作，但目前不需要
            console.error("刪除拆股事件最終失敗:", error);
        });
    });
}

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-split-btn');
    const splitData = {
        date: document.getElementById('split-date').value,
        symbol: document.getElementById('split-symbol').value.toUpperCase().trim(),
        ratio: parseFloat(document.getElementById('split-ratio').value)
    };

    if (!splitData.symbol || isNaN(splitData.ratio) || splitData.ratio <= 0) {
        showNotification('error', '請填寫所有欄位並確保比例大於0。');
        return;
    }
    
    // [核心修改] 關閉視窗並直接呼叫 executeApiAction
    closeModal('split-modal');
    
    executeApiAction('add_split', splitData, {
        loadingText: '正在新增拆股事件...',
        successMessage: '拆股事件已成功新增！'
    }).catch(error => {
        console.error("新增拆股事件最終失敗:", error);
        // 失敗時，可能需要重新打開 modal 讓使用者修正，但暫時保持簡單
    });
}

// --- Public Function ---

export function initializeSplitEventListeners() {
    const manageSplitsBtn = document.getElementById('manage-splits-btn');
    if (manageSplitsBtn) {
        manageSplitsBtn.addEventListener('click', () => openModal('split-modal'));
    }
    
    document.getElementById('split-form').addEventListener('submit', handleSplitFormSubmit);
    document.getElementById('cancel-split-btn').addEventListener('click', () => closeModal('split-modal'));
    
    document.getElementById('splits-table-body').addEventListener('click', (e) => { 
        const btn = e.target.closest('.delete-split-btn');
        if(btn) {
            handleDeleteSplit(btn);
        }
    });
}
