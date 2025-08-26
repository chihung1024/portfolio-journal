// =========================================================================================
// == 檔案：js/events/group.events.js (v3.2 - Final Cleanup)
// == 職責：處理群組管理分頁和彈出視窗的 UI 渲染
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';
// 【修改】統一導入職責更清晰的全局刷新函式
import { refreshAllStagedViews } from '../main.js';


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
    const { groups } = getState();
    const selector = document.getElementById('group-selector');
    if (!selector) return;

    const currentValue = selector.value;

    selector.innerHTML = '<option value="all">全部股票</option>';
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        selector.appendChild(option);
    });

    selector.value = groups.some(g => g.id === currentValue) ? currentValue : 'all';
}


/**
 * 處理群組表單提交（新增或編輯），將其導向暫存區
 */
async function handleGroupFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('group-id').value;
    const isEditing = !!id;

    const groupData = {
        id: id || null,
        name: document.getElementById('group-name').value.trim(),
        description: document.getElementById('group-description').value.trim(),
        transactionIds: Array.from(document.querySelectorAll('input.transaction-checkbox:checked'))
                             .map(cb => cb.value)
    };

    if (!groupData.name) {
        showNotification('error', '群組名稱為必填項。');
        return;
    }

    const { closeModal } = await import('../ui/modals.js');
    closeModal('group-modal');

    const change = {
        op: isEditing ? 'UPDATE' : 'CREATE',
        entity: 'group',
        payload: groupData
    };

    try {
        await apiRequest('stage_change', change);
        showNotification('info', `群組變更已加入暫存區。`);
        await refreshAllStagedViews(); // 【修改】統一呼叫
    } catch (error) {
        showNotification('error', `儲存群組失敗: ${error.message}`);
    }
}

/**
 * 處理刪除群組按鈕點擊，將其導向暫存區
 */
async function handleDeleteGroup(button) {
    const groupId = button.dataset.groupId;
    const { groups } = getState();
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`此群組 "${group.name}" 將被標記為待刪除，在您點擊「全部提交」後才會真正刪除。確定嗎？`, async () => {
        const change = {
            op: 'DELETE',
            entity: 'group',
            payload: { id: groupId }
        };

        try {
            await apiRequest('stage_change', change);
            showNotification('info', '刪除群組操作已加入暫存區。');
            await refreshAllStagedViews(); // 【修改】統一呼叫
        } catch (error) {
            showNotification('error', `刪除群組失敗: ${error.message}`);
        }
    });
}

/**
 * 處理復原刪除群組按鈕點擊
 */
async function handleRevertGroupDelete(button) {
    const changeId = button.dataset.changeId;
    try {
        const result = await apiRequest('revert_staged_change', { changeId });
        if(result.success) {
            showNotification('success', '刪除操作已成功復原。');
            await refreshAllStagedViews(); // 【修改】統一呼叫
        }
    } catch (error) {
        showNotification('error', `復原失敗: ${error.message}`);
    }
}


/**
 * 初始化所有與群組相關的事件監聽器
 */
export function initializeGroupEventListeners() {
    document.getElementById('groups-tab').addEventListener('click', async (e) => {
        const addBtn = e.target.closest('#add-group-btn');
        if (addBtn) {
            const { openModal } = await import('../ui/modals.js');
            openModal('group-modal');
            renderGroupModal(null);
            return;
        }

        const editBtn = e.target.closest('.edit-group-btn');
        if (editBtn) {
            const groupId = editBtn.dataset.groupId;
            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingText = document.getElementById('loading-text');
            
            loadingText.textContent = '正在讀取群組詳細資料...';
            loadingOverlay.style.display = 'flex';

            try {
                const result = await apiRequest('get_group_details', { groupId });
                if (result.success) {
                    const groupToEdit = result.data;
                    const { openModal } = await import('../ui/modals.js');
                    openModal('group-modal');
                    renderGroupModal(groupToEdit);
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                showNotification('error', `讀取群組詳情失敗: ${error.message}`);
            } finally {
                loadingOverlay.style.display = 'none';
                loadingText.textContent = '正在從雲端同步資料...';
            }
            return;
        }

        const deleteBtn = e.target.closest('.delete-group-btn');
        if (deleteBtn) {
            handleDeleteGroup(deleteBtn);
            return;
        }

        const revertBtn = e.target.closest('.revert-delete-group-btn');
        if (revertBtn) {
            handleRevertGroupDelete(revertBtn);
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
    
    const groupModal = document.getElementById('group-modal');
    if (groupModal) {
        groupModal.addEventListener('click', (e) => {
            const expandBtn = e.target.closest('.expand-symbol-btn');
            if (expandBtn) {
                const txList = expandBtn.closest('.symbol-node').querySelector('.transaction-list');
                const icon = expandBtn.querySelector('i');
                txList.classList.toggle('hidden');
                icon.classList.toggle('rotate-90');
                return;
            }
        });
        
        groupModal.addEventListener('change', (e) => {
            if (e.target.matches('.transaction-checkbox')) {
                const symbolNode = e.target.closest('.symbol-node');
                const allTxs = symbolNode.querySelectorAll('.transaction-checkbox');
                const checkedTxs = symbolNode.querySelectorAll('.transaction-checkbox:checked');
                const symbolCheckbox = symbolNode.querySelector('.symbol-checkbox');
                
                if (checkedTxs.length === allTxs.length) {
                    symbolCheckbox.checked = true;
                    symbolCheckbox.indeterminate = false;
                } else if (checkedTxs.length === 0) {
                    symbolCheckbox.checked = false;
                    symbolCheckbox.indeterminate = false;
                } else {
                    symbolCheckbox.checked = false;
                    symbolCheckbox.indeterminate = true;
                }
            }
            else if (e.target.matches('.symbol-checkbox')) {
                const symbolNode = e.target.closest('.symbol-node');
                const allTxs = symbolNode.querySelectorAll('.transaction-checkbox');
                e.target.indeterminate = false;
                allTxs.forEach(txCheckbox => {
                    txCheckbox.checked = e.target.checked;
                });
            }
        });
    }
}

export { loadGroups, updateGroupSelector };