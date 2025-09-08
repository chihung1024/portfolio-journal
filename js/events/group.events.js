// =========================================================================================
// == 檔案：js/events/group.events.js (v_api_cleanup_final)
// == 職責：處理所有與「群組」相關的 UI 事件，並遵循正確的 API 客戶端架構
// =========================================================================================

import { getGroups } from '../state.js';
// 【核心修正】: 移除對不存在的 apiRequest 的依賴，改為導入職責明確的 API 函式
import { addGroup, updateGroup, deleteGroup } from '../api.js';
import { openModal } from '../ui/modals.js';
import { showNotification } from '../ui/utils.js';

/**
 * 初始化群組管理相關的事件監聽器
 */
function initializeGroupEventListeners() {
    const groupContent = document.getElementById('groups-content');
    const groupForm = document.getElementById('group-form');

    if (!groupContent || !groupForm) return;

    // 事件委派：處理編輯和刪除按鈕的點擊
    groupContent.addEventListener('click', (event) => {
        const editButton = event.target.closest('.edit-group-btn');
        const deleteButton = event.target.closest('.delete-group-btn');

        if (editButton) {
            handleEditGroup(editButton.dataset.id);
        } else if (deleteButton) {
            handleDeleteGroup(deleteButton.dataset.id);
        }
    });
    
    // 處理新增群組按鈕
    document.getElementById('add-group-btn')?.addEventListener('click', () => {
        groupForm.reset();
        document.getElementById('group-id').value = '';
        document.getElementById('group-form-title').textContent = '新增群組';
        openModal('group-modal');
    });

    // 處理表單提交（新增或更新）
    groupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleSaveGroup();
    });
}

/**
 * 處理編輯群組的邏輯
 * @param {string} groupId - 要編輯的群組 ID
 */
function handleEditGroup(groupId) {
    const groups = getGroups();
    const group = groups.find(g => g.id.toString() === groupId);
    if (!group) {
        showNotification('找不到該群組', 'error');
        return;
    }

    document.getElementById('group-id').value = group.id;
    document.getElementById('group-name').value = group.name;
    // 注意：`symbols` 欄位在 UI 中可能需要更複雜的處理 (如標籤輸入)，此處為簡化實現
    document.getElementById('group-symbols').value = JSON.parse(group.symbols || '[]').join(', ');
    document.getElementById('group-form-title').textContent = '編輯群組';
    openModal('group-modal');
}

/**
 * 處理儲存群組（新增或更新）的邏輯
 */
async function handleSaveGroup() {
    const form = document.getElementById('group-form');
    const groupId = document.getElementById('group-id').value;
    const name = document.getElementById('group-name').value;
    const symbolsStr = document.getElementById('group-symbols').value;

    const symbols = symbolsStr.split(',')
        .map(s => s.trim().toUpperCase())
        .filter(s => s);

    const groupData = { name, symbols };

    try {
        if (groupId) {
            // 更新現有群組
            await updateGroup(groupId, groupData);
            showNotification('群組更新成功', 'success');
        } else {
            // 新增群組
            await addGroup(groupData);
            showNotification('群組新增成功', 'success');
        }
        document.querySelector('#group-modal [data-dismiss]').click(); // 關閉 modal
        form.reset();
    } catch (error) {
        console.error('儲存群組失敗:', error);
        showNotification('儲存群組失敗，請稍後再試', 'error');
    }
}


/**
 * 處理刪除群組的邏輯
 * @param {string} groupId - 要刪除的群組 ID
 */
async function handleDeleteGroup(groupId) {
    // 實際應用中，此處應有確認對話框
    if (confirm('您確定要刪除這個群組嗎？')) {
        try {
            await deleteGroup(groupId);
            showNotification('群組刪除成功', 'success');
        } catch (error) {
            console.error('刪除群組失敗:', error);
            showNotification('刪除群組失敗，請稍後再試', 'error');
        }
    }
}

export { initializeGroupEventListeners };
