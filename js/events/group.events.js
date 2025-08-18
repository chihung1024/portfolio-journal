// =========================================================================================
// == 檔案：js/events/group.events.js (v2.1 - 移除篩選功能)
// == 職責：處理所有與群組管理相關的用戶互動事件
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';

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
    
    const recalcBtn = document.getElementById('recalculate-group-btn');
    if (selector.value !== 'all') {
         recalcBtn.classList.remove('hidden');
    } else {
         recalcBtn.classList.add('hidden');
    }
}

/**
 * 【核心重構】處理群組表單提交（新增或編輯）
 */
async function handleGroupFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-group-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';

    // 從 DOM 中收集所有被勾選的交易 ID
    const selectedTransactionIds = Array.from(document.querySelectorAll('input.transaction-checkbox:checked'))
                                      .map(cb => cb.value);

    const groupData = {
        id: document.getElementById('group-id').value || null,
        name: document.getElementById('group-name').value.trim(),
        description: document.getElementById('group-description').value.trim(),
        transactionIds: selectedTransactionIds // 發送交易 ID 列表
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
        await loadGroups();
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
            await loadGroups();
        } catch (error) {
            showNotification('error', `刪除群組失敗: ${error.message}`);
        }
    });
}

/**
 * 【核心重構】初始化所有與群組相關的事件監聽器
 */
export function initializeGroupEventListeners() {
    document.getElementById('groups-tab').addEventListener('click', async (e) => {
        const addBtn = e.target.closest('#add-group-btn');
        if (addBtn) {
            renderGroupModal(null);
            openModal('group-modal');
            return;
        }

        const editBtn = e.target.closest('.edit-group-btn');
        if (editBtn) {
            const { groups } = getState();
            const groupId = editBtn.dataset.groupId;
            
            // 【核心修改】為獲取準確的交易列表，需要向後端請求詳細資訊
            try {
                // 假設我們新增一個輕量級 API action: 'get_group_details'
                // 為了簡化，我們先模擬從 `groups` 狀態中查找，並假設它有 `included_transactions`
                const groupToEdit = groups.find(g => g.id === groupId);
                
                // 實際部署時，這裡應該是:
                // const result = await apiRequest('get_group_details', { groupId });
                // const groupToEdit = result.data;
                
                if (groupToEdit) {
                    openModal('group-modal');
                    renderGroupModal(groupToEdit);
                }
            } catch (error) {
                showNotification('error', `讀取群組詳情失敗: ${error.message}`);
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
    document.getElementById('cancel-group-btn').addEventListener('click', () => closeModal('group-modal'));
    
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
                e.target.indeterminate = false; // 用戶手動點擊時，取消“部分選取”狀態
                allTxs.forEach(txCheckbox => {
                    txCheckbox.checked = e.target.checked;
                });
            }
        });

        // 【修改】移除篩選器和批量按鈕的事件監聽器
    }
}

export { loadGroups, updateGroupSelector };
