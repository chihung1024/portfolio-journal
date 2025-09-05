// js/events/group.events.js

import { api } from '../api.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';
import { showModal, hideModal } from '../ui/modals.js';
import state from '../state.js';
import { stagingService } from '../staging.service.js';
import { showNotification } from '../ui/notifications.js';

export function setupGroupEventListeners() {
    const groupsContent = document.getElementById('groups-content');
    const addGroupBtn = document.getElementById('add-group-btn');
    const groupModal = document.getElementById('group-modal');
    const groupForm = document.getElementById('group-form');
    const cancelGroupBtn = document.getElementById('cancel-group-btn');

    // Event Delegation for edit and delete buttons
    if (groupsContent) {
        groupsContent.addEventListener('click', async (event) => {
            const editBtn = event.target.closest('.edit-group-btn');
            const deleteBtn = event.target.closest('.delete-group-btn');

            if (editBtn) {
                const groupId = editBtn.dataset.groupId;
                const group = state.groups.find(g => g.id === groupId);
                if (group) {
                    await renderGroupModal(group);
                    showModal('group-modal');
                }
            }

            if (deleteBtn) {
                const groupId = deleteBtn.dataset.groupId;
                if (confirm('確定要刪除此群組嗎？此操作將會進入暫存區。')) {
                    try {
                        await stagingService.stageAction('DELETE', 'group', { id: groupId });
                        showNotification('群組已標記為刪除，請至暫存區確認。', 'info');
                        await renderGroupsTab();
                    } catch (error) {
                        console.error('Error staging group deletion:', error);
                        showNotification(`標記刪除失敗：${error.message}`, 'error');
                    }
                }
            }
        });
    }

    if (addGroupBtn) {
        addGroupBtn.addEventListener('click', async () => {
            await renderGroupModal();
            showModal('group-modal');
        });
    }

    if (groupForm) {
        groupForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(groupForm);
            const groupId = formData.get('id');
            const payload = {
                id: groupId || `temp_${Date.now()}`,
                name: formData.get('name'),
                description: formData.get('description'),
            };

            const actionType = groupId ? 'UPDATE' : 'CREATE';

            try {
                await stagingService.stageAction(actionType, 'group', payload);
                const message = actionType === 'CREATE' ? '群組已新增至暫存區。' : '群組更新已儲存至暫存區。';
                showNotification(message, 'info');
                hideModal('group-modal');
                await renderGroupsTab();
            } catch (error) {
                console.error(`Error staging group ${actionType.toLowerCase()}:`, error);
                showNotification(`操作失敗：${error.message}`, 'error');
            }
        });
    }

    if (cancelGroupBtn) {
        cancelGroupBtn.addEventListener('click', () => {
            hideModal('group-modal');
        });
    }
}
