// =========================================================================================
// == 筆記事件處理模組 (note.events.js) - 【新檔案】
// == 職責：處理所有與投資筆記相關的用戶互動事件，並整合操作隊列。
// =========================================================================================

import { getState, setState } from '../state.js';
import { addToQueue } from '../op_queue_manager.js';
import { showNotification } from '../ui/notifications.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { renderDetailsModal, switchDetailsTab } from '../ui/components/detailsModal.ui.js';

/**
 * 核心動作：儲存筆記（新增或更新）
 * @param {object} noteData - 包含 symbol, target_price, stop_loss_price, notes 的物件
 * @param {string|null} modalToClose - 操作完成後要關閉的彈窗 ID
 */
async function saveNoteAction(noteData, modalToClose = null) {
    if (modalToClose) {
        const { closeModal } = await import('../ui/modals.js');
        closeModal(modalToClose);
    }

    // 【核心修改】將操作加入隊列
    const success = addToQueue('UPDATE', 'stock_note', noteData);

    if (success) {
        showNotification('info', `筆記變更已暫存。點擊同步按鈕以儲存。`);
        
        // 立即重新渲染持股表格，以反映目標價/停損價等的變化
        const { holdings } = getState();
        renderHoldingsTable(holdings);

        // 如果是從詳情彈窗儲存的，也需要刷新詳情彈窗的內容
        if (modalToClose === null) { // 假設只有詳情彈窗的儲存按鈕不會關閉 modal
             renderDetailsModal(noteData.symbol);
             switchDetailsTab('notes', noteData.symbol); // 保持在筆記分頁
        }
    }
}

/**
 * 處理主筆記彈窗的表單提交
 * @param {Event} e - 事件對象
 */
async function handleNotesFormSubmit(e) {
    e.preventDefault();
    const noteData = {
        symbol: document.getElementById('notes-symbol').value,
        target_price: parseFloat(document.getElementById('target-price').value) || null,
        stop_loss_price: parseFloat(document.getElementById('stop-loss-price').value) || null,
        notes: document.getElementById('notes-content').value.trim()
    };
    saveNoteAction(noteData, 'notes-modal');
}

/**
 * 處理詳情頁內筆記表單的提交
 * @param {Event} e - 事件對象
 */
async function handleDetailsNotesFormSubmit(e) {
    e.preventDefault();
     const noteData = {
        symbol: document.getElementById('details-notes-symbol').value,
        target_price: parseFloat(document.getElementById('details-target-price').value) || null,
        stop_loss_price: parseFloat(document.getElementById('details-stop-loss-price').value) || null,
        notes: document.getElementById('details-notes-content').value.trim()
    };
    // 在詳情頁內儲存筆記後，不關閉彈窗
    saveNoteAction(noteData, null);
}


/**
 * 初始化所有與筆記相關的事件監聽器
 */
export function initializeNoteEventListeners() {
    // 監聽主筆記彈窗的提交與取消
    document.getElementById('notes-form').addEventListener('submit', handleNotesFormSubmit);
    document.getElementById('cancel-notes-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('notes-modal');
    });

    // 為主筆記表單增加 Ctrl+Enter 快捷鍵
    document.getElementById('notes-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            document.getElementById('save-notes-btn').click();
        }
    });

    // 使用事件委派監聽詳情彈窗內的筆記表單提交
    document.getElementById('details-modal').addEventListener('submit', (e) => {
        if (e.target.id === 'details-notes-form') {
            handleDetailsNotesFormSubmit(e);
        }
    });

    // 為詳情彈窗內的筆記表單增加 Ctrl+Enter 快捷鍵
    document.getElementById('details-modal').addEventListener('keydown', (e) => {
        if (e.target.closest('#details-notes-form') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            document.getElementById('details-save-notes-btn').click();
        }
    });
}