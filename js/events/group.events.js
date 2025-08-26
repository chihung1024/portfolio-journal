// =========================================================================================
// == 檔案：js/events/group.events.js (v3.0 - 整合暫存區)
// == 職責：處理群組管理分頁和彈出視窗的 UI 渲染
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, applyGroupView } from '../api.js'; // applyGroupView 仍需保留
import { stagingService } from '../staging.service.js'; // 【核心修改】
import { showNotification } from '../ui/notifications.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';

/**
 * 【新增】操作成功存入暫存區後，更新 UI
 */
async function handleStagingSuccess() {
    showNotification('info', '操作已暫存。點擊「全部提交」以同步至雲端。');
    // 立即重新渲染列表以顯示暫存狀態
    await loadGroups();
}

/**
 * 載入所有群組並更新 UI
 */
async function loadGroups() {
    try {
        const result = await apiRequest('get_groups', {});
        if (result.success) {
            setState({ groups: result.data });
            renderGroupsTab();
            updateGroupSelector();
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

    selector.innerHTML = '<option value="all">全部股票</option>';
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        selector.appendChild(option);
    });
    
    selector.value = groups.some(g => g.id === selectedGroupId) ? selectedGroupId : 'all';
}

/**
 * 處理群組表單提交（新增或編輯）
 */
async function handleGroupFormSubmit(e) {
    e.preventDefault();
    const { closeModal } = await import('../ui/modals.js');

    const groupData = {
        id: document.getElementById('group-id').value || null,
        name: document.getElementById('group-name').value.trim(),
        description: document.getElementById('group-description').value.trim(),
        // 注意：暫存區模式下，我們不直接處理 transactionIds，後端批次處理時會處理關係
    };

    if (!groupData.name) {
        showNotification('error', '群組名稱為必填項。');
        return;
    }

    try {
        if (groupData.id) {
            // 編輯模式
            await stagingService.addAction('UPDATE', 'group', groupData);
        } else {
            // 新增模式
            groupData.id = `temp_group_${Date.now()}`;
            await stagingService.addAction('CREATE', 'group', groupData);
        }
        closeModal('group-modal');
        await handleStagingSuccess();
    } catch (error) {
        showNotification('error', `暫存群組操作失敗: ${error.message}`);
    }
}

/**
 * 處理刪除群組按鈕點擊
 */
async function handleDeleteGroup(button) {
    const groupId = button.dataset.groupId;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`您確定要刪除此群組嗎？此操作將被加入暫存區。`, async () => {
        try {
            await stagingService.addAction('DELETE', 'group', { id: groupId });
            await handleStagingSuccess();
        } catch (error) {
            showNotification('error', `暫存刪除操作失敗: ${error.message}`);
        }
    });
}

/**
 * 初始化所有與群組相關的事件監聽器
 */
export function initializeGroupEventListeners() {
    const groupSelector = document.getElementById('group-selector');

    // 【核心修改】為群組選擇器增加暫存區檢查邏輯
    groupSelector.addEventListener('change', async (e) => {
        const selectedGroupId = e.target.value;
        const stagedActions = await stagingService.getStagedActions();

        if (stagedActions.length > 0) {
            const { showConfirm } = await import('../ui/modals.js');
            showConfirm(
                '您有未提交的變更。切換群組檢視前，必須先提交所有暫存的變更。要繼續嗎？',
                async () => {
                    const { submitBatch } = await import('../api.js');
                    const netActions = await stagingService.getNetActions();
                    await submitBatch(netActions);
                    await stagingService.clearActions();
                    setState({ selectedGroupId });
                    applyGroupView(selectedGroupId);
                },
                '提交並切換檢視？'
            );
            // 還原選擇，等待用戶確認
            e.target.value = getState().selectedGroupId; 
        } else {
            setState({ selectedGroupId });
            applyGroupView(selectedGroupId);
        }
    });


    document.getElementById('groups-tab').addEventListener('click', async (e) => {
        const addBtn = e.target.closest('#add-group-btn');
        if (addBtn) {
            const { openModal } = await import('../ui/modals.js');
            renderGroupModal(null); // 傳入 null 表示新增
            openModal('group-modal');
            return;
        }

        const editBtn = e.target.closest('.edit-group-btn');
        if (editBtn) {
            const groupId = editBtn.dataset.groupId;
            const { groups } = getState();
            const groupToEdit = groups.find(g => g.id === groupId);
            if (groupToEdit) {
                 const { openModal } = await import('../ui/modals.js');
                 renderGroupModal(groupToEdit);
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

    document.getElementById('group-form').addEventListener('submit', handleGroupFormSubmit);
    document.getElementById('cancel-group-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('group-modal');
    });
    
    document.getElementById('group-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.target.matches('textarea')) {
            e.preventDefault();
            if (document.activeElement === document.getElementById('group-name')) {
                document.getElementById('save-group-btn').click();
            }
        }
    });
}

export { loadGroups, updateGroupSelector };