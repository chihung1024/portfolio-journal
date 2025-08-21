// =========================================================================================
// == 拆股事件處理模組 (split.events.js) v3.0 - ATLAS-COMMIT Architecture
// =========================================================================================

import { getState, setState } from '../state.js';
// [核心修改] 引入新的 API 函式
import { stageChange } from '../api.js';
import { showNotification } from '../ui/notifications.js';
// [核心修改] 引入全局刷新函式 (雖然此模組暫無獨立視圖，但為保持架構一致性而引入)
// import { refreshStagedView } from '../main.js'; // 暫時不需要，因為 split 表是全局載入
import { loadPortfolioData } from '../api.js'; // 暫時使用舊的全局刷新


// --- Private Functions ---

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    const { userSplits } = getState();
    const splitToDelete = userSplits.find(s => s.id === splitId);
    if (!splitToDelete) return;

    // [核心修改] 實現樂觀更新與暫存
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('您確定要將此拆股事件加入待辦刪除列表嗎？', async () => {
        
        // 1. 立即在前端模擬刪除
        const originalSplits = [...userSplits];
        const newSplits = userSplits.filter(s => s.id !== splitId); // 樂觀地直接移除
        setState({ userSplits: newSplits });
        // 因為 splits 表沒有自己的暫存視圖，我們暫時先不重繪，等待全局提交
        // renderSplitsTable(); // 如果有獨立的暫存視圖，會在這裡呼叫

        showNotification('info', `拆股事件 ${splitToDelete.symbol} 已加入待辦刪除。`);
        
        // 2. 在背景將「刪除意圖」提交到暫存區
        try {
            await stageChange({
                op: 'DELETE',
                entity: 'split', // 實體類型為 'split'
                payload: { id: splitId }
            });
            // 成功後，可以考慮刷新一個能顯示 split 暫存態的視圖
            // await refreshStagedView(); // 未來若有此功能
        } catch (error) {
            showNotification('error', '刪除操作暫存失敗，已還原變更。');
            setState({ userSplits: originalSplits });
            // renderSplitsTable();
        }
    });
}

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const splitData = {
        // ID 將由後端在 CREATE 時生成
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

    // [核心修改] 實現樂觀更新與暫存

    // 1. 立即在前端模擬新增
    const { userSplits } = getState();
    const originalSplits = [...userSplits];
    // 建立一個帶有臨時 ID 和狀態的物件
    const tempId = `temp_split_${Date.now()}`;
    const newSplit = { ...splitData, id: tempId, status: 'STAGED_CREATE' };
    setState({ userSplits: [newSplit, ...originalSplits] });
    // renderSplitsTable(); // 如果有獨立的暫存視圖，會在這裡呼叫
    
    showNotification('info', `拆股事件 ${splitData.symbol} 已加入待辦新增。`);

    // 2. 在背景將「新增意圖」提交到暫存區
    try {
        await stageChange({
            op: 'CREATE',
            entity: 'split', // 實體類型為 'split'
            payload: splitData
        });
        // 成功後，刷新視圖
        // await refreshStagedView();
    } catch (error) {
        showNotification('error', '新增操作暫存失敗，已還原變更。');
        setState({ userSplits: originalSplits });
        // renderSplitsTable();
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
}
