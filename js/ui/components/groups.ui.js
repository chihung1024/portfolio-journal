// =========================================================================================
// == 檔案：js/ui/components/groups.ui.js (v4.0 - Selector-Driven)
// == 職責：處理群組管理分頁和彈出視窗的 UI 渲染
// =========================================================================================

import { getState } from '../../state.js';
// 【核心修改】直接從 selector 獲取最終數據
import { selectCombinedGroups } from '../../selectors.js';

/**
 * 渲染群組管理分頁的內容
 */
export async function renderGroupsTab() {
    const container = document.getElementById('groups-content');
    if (!container) return;

    // 【核心修改】直接從 selector 獲取合併後的數據
    const combinedGroups = await selectCombinedGroups();

    if (combinedGroups.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">尚未建立任何群組。</p>`;
        return;
    }

    container.innerHTML = combinedGroups.map(group => {
        // 根據暫存狀態決定背景色
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
 * 渲染群組編輯/新增彈出視窗的內容
 * @param {Object|null} groupToEdit - (可選) 要編輯的群組物件
 */
export async function renderGroupModal(groupToEdit = null) {
    const form = document.getElementById('group-form');
    form.reset();
    
    // 注意：此處的邏輯維持不變，因為編輯的對象是單一實體，
    // 其最新狀態已由 handleEdit 事件處理器從 selector 獲取並傳入。
    const finalGroupData = groupToEdit;

    document.getElementById('group-id').value = finalGroupData ? finalGroupData.id : '';
    document.getElementById('group-modal-title').textContent = finalGroupData ? `編輯群組：${finalGroupData.name}` : '新增群組';
    document.getElementById('group-name').value = finalGroupData ? finalGroupData.name : '';
    document.getElementById('group-description').value = finalGroupData ? finalGroupData.description || '' : '';

    const symbolsContainer = document.getElementById('group-symbols-container');
    symbolsContainer.innerHTML = `<p class="text-center text-sm text-gray-500 py-4">群組內的交易紀錄管理將在提交後處理。</p>`;
}