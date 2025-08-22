// =========================================================================================
// == 檔案：js/events/group.events.js (v3.0.0 - (核心重構) 支援 ATLAS-COMMIT)
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderGroupsTab, renderGroupModal } from '../ui/components/groups.ui.js';
import { updateStagingBanner } from '../ui/components/stagingBanner.ui.js';
import { v4 as uuidv4 } from 'https://jspm.dev/uuid';

/**
 * 載入所有群組並更新 UI (此函式邏輯不變)
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
 * 更新頂部的全局群組篩選器下拉選單 (此函式邏輯不變)
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
 * 【重構】處理群組表單提交（新增或編輯），現在只處理群組元數據，不處理成員歸屬。
 * 成員歸屬將通過微觀編輯 (`membership-editor-modal`) 另行處理。
 */
async function handleGroupFormSubmit(e) {
    e.preventDefault();
    // ... 此處邏輯可以簡化，或維持現狀，因為群組的創建/編輯頻率不高
    // 暫時維持原有的直接提交模式，以簡化首次重構的複雜度。
    const saveBtn = document.getElementById('save-group-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';

    const selectedTransactionIds = Array.from(document.querySelectorAll('input.transaction-checkbox:checked'))
                                      .map(cb => cb.value);

    const groupData = {
        id: document.getElementById('group-id').value || null,
        name: document.getElementById('group-name').value.trim(),
        description: document.getElementById('group-description').value.trim(),
        transactionIds: selectedTransactionIds
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
 * 【重構】處理微觀編輯視窗中的儲存按鈕，將群組歸屬變更納入暫存區
 */
async function handleMembershipSave() {
    const { tempMembershipEdit } = getState();
    if (!tempMembershipEdit) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="membership_group"]:checked')).map(cb => cb.value);
    
    closeModal('membership-editor-modal');
    
    const payload = {
        transactionId: tempMembershipEdit.txId,
        groupIds: selectedGroupIds
    };
    const entityId = tempMembershipEdit.txId; // 以 transactionId 作為此變更的唯一標識
    const op = 'UPDATE';
    const entity = 'group_membership';
    
    // 步驟 1: 樂觀更新 (此操作沒有直接的視覺回饋，主要是在 state 中記錄)
    const currentState = getState();
    const change = { id: entityId, op, entity, payload };

    // 為了避免重複，先從 stagedChanges 移除同一個 transaction 的舊歸屬變更
    const otherChanges = currentState.stagedChanges.filter(c => 
        !(c.entity === 'group_membership' && c.payload.transactionId === entityId)
    );

    setState({
        stagedChanges: [...otherChanges, change],
        hasStagedChanges: true
    });

    updateStagingBanner();

    // 步驟 2: 背景發送暫存請求
    apiRequest('stage_change', { op, entity, payload })
        .then(() => {
            showNotification('info', '一筆群組歸屬變更已加入待辦。');
        })
        .catch(error => {
            showNotification('error', `暫存歸屬變更失敗: ${error.message}`);
            // 由於沒有直接UI變化，這裡可以只報錯，不還原UI
            setState({
                stagedChanges: currentState.stagedChanges,
                hasStagedChanges: currentState.stagedChanges.length > 0
            });
            updateStagingBanner();
        });
}


/**
 * 處理刪除群組按鈕點擊 (維持原有直接刪除模式，因為這是破壞性操作，需要立即反饋)
 */
async function handleDeleteGroup(button) {
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
 * 初始化所有與群組相關的事件監聽器
 */
export function initializeGroupEventListeners() {
    document.getElementById('groups-tab').addEventListener('click', async (e) => {
        const addBtn = e.target.closest('#add-group-btn');
        if (addBtn) {
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
    });

    document.getElementById('group-form').addEventListener('submit', handleGroupFormSubmit);
    
    document.getElementById('cancel-group-btn').addEventListener('click', () => {
        closeModal('group-modal');
    });
    
    // 【新增】為微觀編輯 modal 的保存按鈕綁定新的處理函式
    document.getElementById('save-membership-btn').addEventListener('click', handleMembershipSave);
    
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
