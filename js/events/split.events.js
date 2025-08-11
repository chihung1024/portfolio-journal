// =========================================================================================
// == 拆股事件處理模組 (split.events.js)
// == 職責：處理所有與拆股事件相關的用戶互動事件。
// =========================================================================================

import { apiRequest, loadPortfolioData } from '../api.js';
// 【修正前】: import { openModal, closeModal, showConfirm, showNotification } from '../ui/modals.js';
// 【修正後】: 分開從各自的模組引入
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';

// --- Private Functions ---

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    showConfirm('確定要刪除這個拆股事件嗎？', async () => {
        try {
            await apiRequest('delete_split', { splitId });
            showNotification('success', '拆股事件已刪除！');
            await loadPortfolioData();
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        }
    });
}

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-split-btn');
    saveBtn.disabled = true;
    const splitData = {
        date: document.getElementById('split-date').value,
        symbol: document.getElementById('split-symbol').value.toUpperCase().trim(),
        ratio: parseFloat(document.getElementById('split-ratio').value)
    };

    if (!splitData.symbol || isNaN(splitData.ratio) || splitData.ratio <= 0) {
        showNotification('error', '請填寫所有欄位並確保比例大於0。');
        saveBtn.disabled = false;
        return;
    }
    try {
        await apiRequest('add_split', splitData);
        closeModal('split-modal');
        await loadPortfolioData();
    } catch (error) {
        showNotification('error', `新增拆股事件失敗: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存';
    }
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
