// =========================================================================================
// == 檔案：js/events/group.events.js (v3.0 - 整合暫存區)
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';
import { stagingService } from '../staging.service.js';
import { updateStagedCountBadge } from './staging.events.js';

// 保留此函式用於初始載入
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

async function handleGroupFormSubmit(e) {
    e.preventDefault();
    const form = document.getElementById('group-form');
    const groupData = {
        id: form.querySelector('#group-id').value || null,
        name: form.querySelector('#group-name').value.trim(),
        transactionIds: Array.from(form.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value)
    };

    if (!groupData.name) {
        showNotification('error', '群組名稱為必填項。');
        return;
    }

    const { closeModal } = await import('../ui/modals.js');
    closeModal('group-modal');

    try {
        if (groupData.id) {
            await stagingService.addAction({
                type: 'UPDATE',
                entity: 'GROUP',
                payload: groupData
            });
            showNotification('success', '群組編輯操作已加入暫存區。');
        } else {
            const tempId = `temp_${self.crypto.randomUUID()}`;
            groupData.id = tempId;
            await stagingService.addAction({
                type: 'CREATE',
                entity: 'GROUP',
                payload: groupData
            });
            showNotification('success', '新增群組操作已加入暫存區。');
        }
        await updateStagedCountBadge();
        renderGroupsTab();
    } catch (error) {
        showNotification('error', `儲存群組失敗: ${error.message}`);
    }
}

async function handleDeleteGroup(button) {
    const groupId = button.dataset.groupId;
    const { groups } = getState();
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`確定要將群組 "${group.name}" 的刪除操作加入暫存區嗎？`, async () => {
        try {
            await stagingService.addAction({
                type: 'DELETE',
                entity: 'GROUP',
                payload: { id: groupId }
            });
            showNotification('success', '刪除操作已加入暫存區。');
            await updateStagedCountBadge();
            renderGroupsTab();
        } catch (error) {
            showNotification('error', `刪除群組失敗: ${error.message}`);
        }
    });
}

export function initializeGroupEventListeners() {
    const groupsTab = document.getElementById('groups-tab');
    if (groupsTab) {
        groupsTab.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            if (button.id === 'add-group-btn') {
                const { openModal } = await import('../ui/modals.js');
                renderGroupModal(null); // 傳入 null 來清空並準備新增
                openModal('group-modal');
            } else if (button.classList.contains('edit-group-btn')) {
                const groupId = button.dataset.groupId;
                const { groups } = getState();
                const groupToEdit = groups.find(g => g.id === groupId);
                const { openModal } = await import('../ui/modals.js');
                renderGroupModal(groupToEdit);
                openModal('group-modal');
            } else if (button.classList.contains('delete-group-btn')) {
                handleDeleteGroup(button);
            }
        });
    }

    const groupForm = document.getElementById('group-form');
    if (groupForm) {
        groupForm.addEventListener('submit', handleGroupFormSubmit);
    }

    // Listener for the global group selector dropdown
    const groupSelector = document.getElementById('group-selector');
    let previousGroupId = groupSelector ? groupSelector.value : 'all';

    if (groupSelector) {
        groupSelector.addEventListener('focus', (e) => {
            previousGroupId = e.target.value;
        });

        groupSelector.addEventListener('change', async (e) => {
            const selectedGroupId = e.target.value;
            const stagedActions = await stagingService.getActions();

            if (stagedActions.length > 0) {
                const { showConfirm } = await import('../ui/modals.js');
                showConfirm(
                    '您有未提交的變更。切換視圖將會先提交所有變更，是否繼續？',
                    async () => { // onConfirm
                        try {
                            const netActions = await stagingService.getNetActions();
                            if (netActions.length > 0) {
                                await submitBatch(netActions);
                            }
                            await stagingService.clearActions();
                            await updateStagedCountBadge();
                            showNotification('success', '變更已提交！正在更新群組視圖...');
                            await applyGroupView(selectedGroupId);
                        } catch (error) {
                            showNotification('error', `操作失敗: ${error.message}`);
                            e.target.value = previousGroupId; // Revert selector on failure
                        }
                    },
                    () => { // onCancel
                        e.target.value = previousGroupId; // Revert selector on cancel
                    }
                );
            } else {
                await applyGroupView(selectedGroupId);
            }
        });
    }
}

export { loadGroups, updateGroupSelector };
