// =========================================================================================
// == 檔案：js/events/group.events.js (新增檔案)
// == 職責：處理所有與群組管理相關的用戶互動事件
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';
import { loadPortfolioData } from '../api.js'; // 引入以更新全局選擇器

/**
 * 載入所有群組並更新 UI
 */
async function loadGroups() {
    try {
        const result = await apiRequest('get_groups', {});
        if (result.success) {
            setState({ groups: result.data });
            renderGroupsTab();
            updateGroupSelector(); // 更新頂部的全局選擇器
        }
    } catch (error) {
        showNotification('error', `讀取群組失敗: ${error.message}`);
    }
}

/**
 * 更新頂部的全局群組篩選器下拉選單
 */
function updateGroupSelector() {
    const { groups, selectedGroupId } = getState();
    const selector = document.getElementById('group-selector');
    if (!selector) return;

    // 保存當前選中的值
    const currentValue = selector.value;

    selector.innerHTML = '<option value="all">全部股票</option>'; // 重置並加入預設選項
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        selector.appendChild(option);
    });

    // 嘗試恢復之前的選中值，如果不存在則預設為 'all'
    selector.value = groups.some(g => g.id === currentValue) ? currentValue : 'all';
    if (selector.value !== 'all') {
         document.getElementById('recalculate-group-btn').classList.remove('hidden');
    } else {
         document.getElementById('recalculate-group-btn').classList.add('hidden');
    }
}

/**
 * 處理群組表單提交（新增或編輯）
 */
async function handleGroupFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-group-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';

    const selectedSymbols = Array.from(document.querySelectorAll('input[name="group_symbols"]:checked')).map(cb => cb.value);

    const groupData = {
        id: document.getElementById('group-id').value || null,
        name: document.getElementById('group-name').value.trim(),
        description: document.getElementById('group-description').value.trim(),
        symbols: selectedSymbols
    };

    if (!groupData.name) {
        showNotification('error', '群組名稱為必填項。');
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存群組';
        return;
    }

    try {
        await apiRequest('save_group', groupData);
        closeModal('group-modal');
        showNotification('success', '群組已成功儲存！');
        await loadGroups(); // 重新載入群組列表
    } catch (error) {
        showNotification('error', `儲存群組失敗: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存群組';
    }
}

/**
 * 處理刪除群組按鈕點擊
 */
function handleDeleteGroup(button) {
    const groupId = button.dataset.groupId;
    const { groups } = getState();
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    showConfirm(`您確定要刪除群組 "${group.name}" 嗎？此操作無法復原。`, async () => {
        try {
            await apiRequest('delete_group', { groupId });
            showNotification('success', '群組已刪除。');
            await loadGroups(); // 重新載入群組列表
        } catch (error) {
            showNotification('error', `刪除群組失敗: ${error.message}`);
        }
    });
}

/**
 * 初始化所有與群組相關的事件監聽器
 */
export function initializeGroupEventListeners() {
    // 監聽 "群組管理" 分頁內的點擊
    document.getElementById('groups-tab').addEventListener('click', (e) => {
        const addBtn = e.target.closest('#add-group-btn');
        if (addBtn) {
            renderGroupModal(null); // 傳入 null 表示新增
            openModal('group-modal');
            return;
        }

        const editBtn = e.target.closest('.edit-group-btn');
        if (editBtn) {
            const { groups } = getState();
            const group = groups.find(g => g.id === editBtn.dataset.groupId);
            if (group) {
                renderGroupModal(group); // 傳入要編輯的群組物件
                openModal('group-modal');
            }
            return;
        }

        const deleteBtn = e.target.closest('.delete-group-btn');
        if (deleteBtn) {
            handleDeleteGroup(deleteBtn);
            return;
        }
    });

    // 監聽群組表單提交與取消
    document.getElementById('group-form').addEventListener('submit', handleGroupFormSubmit);
    document.getElementById('cancel-group-btn').addEventListener('click', () => closeModal('group-modal'));
}

// 匯出 loadGroups 供主程式使用
export { loadGroups };
