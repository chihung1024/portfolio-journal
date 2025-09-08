// =========================================================================================
// == 檔案：js/events/split.events.js (v_arch_cleanup_final_s2)
// == 職責：處理所有與「股票分割」相關的 UI 事件，並遵循正確的 API 客戶端架構
// =========================================================================================

import { getSplits } from '../state.js';
// 【核心修正】: 移除對任何泛用 API 函式的依賴，改為導入職責明確的 API 函式
import { addSplit, updateSplit, deleteSplit } from '../api.js';
import { openModal } from '../ui/modals.js';
import { showNotification } from '../ui/utils.js';

/**
 * 初始化股票分割相關的事件監聽器
 */
function initializeSplitEventListeners() {
    const splitForm = document.getElementById('split-form');
    if (!splitForm) return;

    // 監聽表單提交（新增或更新）
    splitForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleSaveSplit();
    });

    // 透過事件委派處理編輯和刪除按鈕
    document.getElementById('splits-content')?.addEventListener('click', (event) => {
        const editButton = event.target.closest('.edit-split-btn');
        if (editButton) {
            handleEditSplit(editButton.dataset.id);
            return;
        }

        const deleteButton = event.target.closest('.delete-split-btn');
        if (deleteButton) {
            handleDeleteSplit(deleteButton.dataset.id);
            return;
        }
    });

    // 處理 "新增股票分割" 按鈕
    document.getElementById('add-split-btn')?.addEventListener('click', () => {
        splitForm.reset();
        document.getElementById('split-id').value = '';
        document.getElementById('split-form-title').textContent = '新增股票分割';
        openModal('split-modal');
    });
}

/**
 * 處理編輯股票分割的邏輯
 * @param {string} splitId - 要編輯的分割事件 ID
 */
function handleEditSplit(splitId) {
    const splits = getSplits();
    const split = splits.find(s => s.id.toString() === splitId);
    if (!split) {
        showNotification('找不到該筆分割紀錄', 'error');
        return;
    }

    document.getElementById('split-id').value = split.id;
    document.getElementById('split-form-title').textContent = '編輯股票分割';
    document.getElementById('split-symbol').value = split.symbol;
    document.getElementById('split-ex-date').value = new Date(split.ex_date).toISOString().split('T')[0];
    document.getElementById('split-from-factor').value = split.from_factor;
    document.getElementById('split-to-factor').value = split.to_factor;
    
    openModal('split-modal');
}

/**
 * 處理儲存股票分割（新增或更新）的邏輯
 */
async function handleSaveSplit() {
    const form = document.getElementById('split-form');
    const splitId = document.getElementById('split-id').value;
    const splitData = {
        symbol: document.getElementById('split-symbol').value.toUpperCase(),
        ex_date: document.getElementById('split-ex-date').value,
        from_factor: parseFloat(document.getElementById('split-from-factor').value),
        to_factor: parseFloat(document.getElementById('split-to-factor').value),
    };

    try {
        if (splitId) {
            await updateSplit(splitId, splitData);
            showNotification('股票分割更新成功', 'success');
        } else {
            await addSplit(splitData);
            showNotification('股票分割新增成功', 'success');
        }
        document.querySelector('#split-modal [data-dismiss]').click(); // 關閉 modal
        form.reset();
    } catch (error) {
        console.error('儲存股票分割失敗:', error);
        showNotification('儲存股票分割失敗，請稍後再試', 'error');
    }
}

/**
 * 處理刪除股票分割的邏輯
 * @param {string} splitId - 要刪除的分割事件 ID
 */
async function handleDeleteSplit(splitId) {
    if (confirm('您確定要刪除此筆股票分割紀錄嗎？')) {
        try {
            await deleteSplit(splitId);
            showNotification('股票分割刪除成功', 'success');
        } catch (error) {
            console.error('刪除股票分割失敗:', error);
            showNotification('刪除股票分割失敗，請稍後再試', 'error');
        }
    }
}

export { initializeSplitEventListeners };
