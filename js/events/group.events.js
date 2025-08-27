// =========================================================================================
// == 檔案：js/events/group.events.js (v5.0 - Decoupled & Bug Fixed)
// =========================================================================================

import { getState, setState } from '../state.js';
// 【核心修改】引入新的、原子化的 api 函式
import { apiRequest, applyGroupView, fetchAllCoreData, submitBatch } from '../api.js';
import { stagingService } from '../staging.service.js';
import { showNotification } from '../ui/notifications.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';
import { selectCombinedGroups } from '../selectors.js';

/**
 * 操作成功存入暫存區後，更新 UI
 */
async function handleStagingSuccess() {
    showNotification('info', '操作已暫存。點擊「全部提交」以同步至雲端。');
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
            await renderGroupsTab();
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
    };

    if (!groupData.name) {
        showNotification('error', '群組名稱為必填項。');
        return;
    }

    try {
        if (groupData.id) {
            await stagingService.addAction('UPDATE', 'group', groupData);
        } else {
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

    groupSelector.addEventListener('change', async (e) => {
        const selectedGroupId = e.target.value;
        const previousGroupId = getState().selectedGroupId;
        const stagedActions = await stagingService.getStagedActions();

        if (stagedActions.length > 0 && selectedGroupId !== previousGroupId) {
            const { showConfirm, hideConfirm } = await import('../ui/modals.js');
            showConfirm(
                '您有未提交的變更。切換群組檢視前，必須先提交所有暫存的變更。要繼續嗎？',
                // ========================= 【核心修改 - 開始】 =========================
                async () => { // 確認回呼
                    hideConfirm();
                    const loadingOverlay = document.getElementById('loading-overlay');
                    const loadingText = document.getElementById('loading-text');
                    loadingText.textContent = '正在提交變更...';
                    loadingOverlay.style.display = 'flex';
                    
                    try {
                        const netActions = await stagingService.getNetActions();
                        
                        // 步驟 1: 呼叫純粹的 submitBatch API
                        const submitResult = await submitBatch(netActions);

                        if (submitResult.success) {
                            await stagingService.clearActions();
                            
                            // 步驟 2: 主動刷新所有核心數據，確保 state 與後端同步
                            loadingText.textContent = '正在同步最新數據...';
                            await fetchAllCoreData(false); // false 表示不重複顯示 loading
                            
                            // 步驟 3: 在數據完全同步的基礎上，安全地計算並應用新的群組視圖
                            loadingText.textContent = '正在計算群組績效...';
                            setState({ selectedGroupId }); // 更新 state 中的群組 ID
                            await applyGroupView(selectedGroupId);
                        }
                    } catch (error) {
                        console.error("提交並切換檢視時發生錯誤:", error);
                        e.target.value = previousGroupId;
                        setState({ selectedGroupId: previousGroupId });
                        showNotification('error', `操作失敗: ${error.message}`);
                    } finally {
                        loadingOverlay.style.display = 'none';
                    }
                },
                // ========================= 【核心修改 - 結束】 =========================
                '提交並切換檢視？',
                () => { // 取消回呼
                    hideConfirm();
                    e.target.value = previousGroupId;
                }
            );
        } else {
            setState({ selectedGroupId });
            applyGroupView(selectedGroupId);
        }
    });


    document.getElementById('groups-tab').addEventListener('click', async (e) => {
        const addBtn = e.target.closest('#add-group-btn');
        if (addBtn) {
            const { openModal } = await import('../ui/modals.js');
            await renderGroupModal(null);
            openModal('group-modal');
            return;
        }

        const editBtn = e.target.closest('.edit-group-btn');
        if (editBtn) {
            const groupId = editBtn.dataset.groupId;
            const combinedGroups = await selectCombinedGroups();
            const groupToEdit = combinedGroups.find(g => g.id === groupId);

            if (groupToEdit) {
                 const { openModal } = await import('../ui/modals.js');
                 await renderGroupModal(groupToEdit);
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