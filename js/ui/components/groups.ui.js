// =========================================================================================
// == 檔案：js/ui/components/groups.ui.js (最終修正版)
// == 職責：處理群組管理分頁和彈出視窗的 UI 渲染
// =========================================================================================

import { getState } from '../../state.js';

/**
 * 渲染群組管理分頁的內容
 */
export function renderGroupsTab() {
    const { groups } = getState();
    const container = document.getElementById('groups-content');
    if (!container) return;

    if (groups.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">尚未建立任何群組。</p>`;
        return;
    }

    container.innerHTML = groups.map(group => `
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 flex justify-between items-center">
            <div>
                <h4 class="font-bold text-lg text-gray-800">${group.name}</h4>
                <p class="text-sm text-gray-600 mt-1">${group.description || '沒有描述'}</p>
                <div class="mt-2 flex flex-wrap gap-2">
                    ${(group.symbols || []).map(s => `<span class="text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-indigo-600 bg-indigo-200">${s}</span>`).join('') || '<span class="text-xs text-gray-500">此群組目前不包含任何股票。</span>'}
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
    `).join('');

    lucide.createIcons(); // 重新渲染圖示
}

/**
 * 渲染群組編輯/新增彈出視窗的內容
 * @param {Object|null} groupToEdit - (可選) 要編輯的群組物件
 */
export function renderGroupModal(groupToEdit = null) {
    const { transactions } = getState();
    const form = document.getElementById('group-form');
    form.reset();

    // 【核心修正點】確保 groupToEdit 的資料被正確填入 input 和 textarea
    document.getElementById('group-id').value = groupToEdit ? groupToEdit.id : '';
    document.getElementById('group-modal-title').textContent = groupToEdit ? `編輯群組：${groupToEdit.name}` : '新增群組';
    document.getElementById('group-name').value = groupToEdit ? groupToEdit.name : '';
    document.getElementById('group-description').value = groupToEdit ? groupToEdit.description || '' : '';

    const symbolsContainer = document.getElementById('group-symbols-container');
    const allSymbols = [...new Set(transactions.map(t => t.symbol.toUpperCase()))].sort();
    const groupSymbols = new Set(groupToEdit ? (groupToEdit.symbols || []) : []);

    if (allSymbols.length > 0) {
        symbolsContainer.innerHTML = allSymbols.map(symbol => `
            <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                <input type="checkbox" name="group_symbols" value="${symbol}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${groupSymbols.has(symbol) ? 'checked' : ''}>
                <span class="font-mono text-sm font-medium text-gray-700">${symbol}</span>
            </label>
        `).join('');
    } else {
        symbolsContainer.innerHTML = `<p class="text-center text-sm text-gray-500 py-4">您的投資組合中還沒有任何交易，無法選擇股票。</p>`;
    }
}
