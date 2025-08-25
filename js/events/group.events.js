// =========================================================================================
// == 檔案：js/events/group.events.js (v3.1 - Centralized Refresh)
// == 職責：處理群組管理分頁和彈出視窗的 UI 渲染與事件
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';

// ========================= 【核心修改 - 開始】 =========================
// 導入全局的、統一的刷新函式
import { refreshAllStagedViews } from '../app.js';
// ========================= 【核心修改 - 結束】 =========================

/**
 * 處理群組表單提交（新增或編輯），將其送入暫存區
 */
async function handleGroupFormSubmit(e) {
    e.preventDefault();
    const groupData = {
        id: document.getElementById('group-id').value || null,
        name: document.getElementById('group-name').value.trim(),
        description: document.getElementById('group-description').value.trim(),
        transactionIds: Array.from(document.querySelectorAll('input.transaction-checkbox:checked')).map(cb => cb.value)
    };

    if (!groupData.name) {
        showNotification('error', '群組名稱為必填項。');
        return;
    }

    const { closeModal } = await import('../ui/modals.js');
    closeModal('group-modal');

    const change = {
        op: groupData.id ? 'UPDATE' : 'CREATE',
        entity: 'group',
        payload: groupData
    };

    try {
        await apiRequest('stage_change', change);
        showNotification('info', `群組變更已加入暫存區。`);
        await refreshAllStagedViews(); // <--- 使用全局刷新
    } catch (error) {
        showNotification('error', `操作失敗: ${error.message}`);
    }
}

/**
 * 處理刪除群組按鈕點擊，將其送入暫存區
 */
async function handleDeleteGroup(button) {
    const groupId = button.dataset.groupId;
    const { groups } = getState();
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`群組 "${group.name}" 將被標記為待刪除。確定嗎？`, async () => {
        const change = {
            op: 'DELETE',
            entity: 'group',
            payload: { id: groupId }
        };
        try {
            await apiRequest('stage_change', change);
            showNotification('info', `刪除操作已加入暫存區。`);
            await refreshAllStagedViews(); // <--- 使用全局刷新
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        }
    });
}

async function handleRevertChange(button) {
    const changeId = button.dataset.changeId;
    try {
        await apiRequest('revert_staged_change', { changeId });
        showNotification('success', '操作已成功復原。');
        await refreshAllStagedViews(); // <--- 使用全局刷新
    } catch (error) {
        showNotification('error', `復原失敗: ${error.message}`);
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
        if (group.status !== 'STAGED_DELETE') {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            if (group.status === 'STAGED_CREATE') {
                option.textContent += ' (暫存中)';
            }
            selector.appendChild(option);
        }
    });
    selector.value = groups.some(g => g.id === currentValue) ? currentValue : 'all';
}

/**
 * 初始載入群組列表（包含暫存狀態）
 */
export async function loadGroups() {
    try {
        const result = await apiRequest('get_groups_with_staging', {});
        if (result.success) {
            const currentState = getState();
            setState({ 
                groups: result.data.groups || [],
                // 合併 hasStagedChanges 狀態，避免覆蓋其他模組的狀態
                hasStagedChanges: currentState.hasStagedChanges || result.data.hasStagedChanges
            });
            renderGroupsTab();
            updateGroupSelector();
        }
    } catch (error) {
        showNotification('error', `讀取群組失敗: ${error.message}`);
    }
}

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
            const { openModal } = await import('../ui/modals.js');
            openModal('group-modal', true, { groupId });
            return;
        }
        const deleteBtn = e.target.closest('.delete-group-btn');
        if (deleteBtn) return handleDeleteGroup(deleteBtn);

        const revertBtn = e.target.closest('.revert-change-btn');
        if(revertBtn) return handleRevertChange(revertBtn);
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
            } else if (e.target.matches('.symbol-checkbox')) {
                const symbolNode = e.target.closest('.symbol-node');
                const allTxs = symbolNode.querySelectorAll('.transaction-checkbox');
                e.target.indeterminate = false;
                allTxs.forEach(txCheckbox => txCheckbox.checked = e.target.checked);
            }
        });
    }
}