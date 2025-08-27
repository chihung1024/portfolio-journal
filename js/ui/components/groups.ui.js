// =========================================================================================
// == 檔案：js/ui/components/groups.ui.js (v3.0 - 整合暫存區狀態)
// == 職責：處理群組管理分頁和彈出視窗的 UI 渲染
// =========================================================================================

import { getState } from '../../state.js';
import { stagingService } from '../../staging.service.js'; // 【核心修改】
import { selectCombinedGroups } from '../../selectors.js';

/**
 * 渲染群組管理分頁的內容
 */
export async function renderGroupsTab() {
    const { groups } = getState();
    const container = document.getElementById('groups-content');
    if (!container) return;

    // 【核心修改】從 selector 獲取已合併的群組列表
    const combinedGroups = await selectCombinedGroups();
    
    if (combinedGroups.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">尚未建立任何群組。</p>`;
        return;
    }

    container.innerHTML = combinedGroups.map(group => {
        // 【核心修改】根據暫存狀態決定背景色
        let stagingClass = 'bg-gray-50'; // 預設
        if (group._staging_status === 'CREATE') stagingClass = 'bg-staging-create';
        else if (group._staging_status === 'UPDATE') stagingClass = 'bg-staging-update';
        else if (group._staging_status === 'DELETE') stagingClass = 'bg-staging-delete opacity-70';

        return `
        <div class="${stagingClass} border border-gray-200 rounded-lg p-4 flex justify-between items-center">
            <div>
                <h4 class="font-bold text-lg text-gray-800">${group.name}</h4>
                <p class="text-sm text-gray-600 mt-1">${group.description || '沒有描述'}</p>
                <div class="mt-2 text-xs text-gray-500">
                    <span>包含 <strong>${(group.symbols || []).length}</strong> 檔股票</span>
                    <span class="mx-2">|</span>
                    <span>共 <strong>${group.transaction_count || 0}</strong> 筆交易</span>
                </div>
            </div>
            <div class="flex-shrink-0 flex items-center space-x-2 ml-4">
                <button data-group-id="${group.id}" class="edit-group-btn btn p-2 text-gray-500 hover:text-indigo-600">
                    <i data-lucide="edit" class="w-5 h-5"></i>
                </button>
                <button data-group-id="${group.id}" class="delete-group-btn btn p-2 text-gray-500 hover:text-red-600">
                    <i data-lucide="trash-2" class="w-5 h-5"></i>
                </button>
            </div>
        </div>
    `}).join('');

    lucide.createIcons();
}

/**
 * 【核心修改】渲染群組編輯/新增彈出視窗的內容 (現在為 async)
 * @param {Object|null} groupToEdit - (可選) 要編輯的群組物件
 */
export async function renderGroupModal(groupToEdit = null) {
    const { transactions } = getState();
    const form = document.getElementById('group-form');
    form.reset();

    let finalGroupData = groupToEdit ? { ...groupToEdit } : null;

    // 如果是編輯模式，檢查暫存區是否有更新的版本
    if (groupToEdit) {
        const stagedActions = await stagingService.getStagedActions();
        const stagedUpdate = stagedActions.find(a => a.entity === 'group' && a.type === 'UPDATE' && a.payload.id === groupToEdit.id);
        if (stagedUpdate) {
            finalGroupData = { ...finalGroupData, ...stagedUpdate.payload };
        }
    }

    document.getElementById('group-id').value = finalGroupData ? finalGroupData.id : '';
    document.getElementById('group-modal-title').textContent = finalGroupData ? `編輯群組：${finalGroupData.name}` : '新增群組';
    document.getElementById('group-name').value = finalGroupData ? finalGroupData.name : '';
    document.getElementById('group-description').value = finalGroupData ? finalGroupData.description || '' : '';

    const symbolsContainer = document.getElementById('group-symbols-container');
    symbolsContainer.innerHTML = `<p class="text-center text-sm text-gray-500 py-4">群組內的交易紀錄管理將在提交後處理。</p>`;
}