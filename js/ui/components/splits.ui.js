// =========================================================================================
// == 拆股事件 UI 模組 (splits.ui.js) v3.0 - Selector-Driven
// =========================================================================================

import { getState } from '../../state.js';
// 【核心修改】直接從 selector 獲取最終數據
import { selectCombinedSplits } from '../../selectors.js';

export async function renderSplitsTable() {
    const tableBody = document.getElementById('splits-table-body');
    if (!tableBody) return;

    // 【核心修改】直接從 selector 獲取合併後的數據
    const combinedSplits = await selectCombinedSplits();

    if (combinedSplits.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">沒有自定義拆股事件。</td></tr>`;
        return;
    }
    
    tableBody.innerHTML = combinedSplits.map(s => {
        // 根據暫存狀態決定背景色
        let stagingClass = '';
        if (s._staging_status === 'CREATE') stagingClass = 'bg-staging-create';
        else if (s._staging_status === 'DELETE') stagingClass = 'bg-staging-delete opacity-70';

        return `
            <tr class="${stagingClass}">
                <td class="px-6 py-4 whitespace-nowrap">${s.date.split('T')[0]}</td>
                <td class="px-6 py-4 whitespace-nowrap font-medium">${s.symbol.toUpperCase()}</td>
                <td class="px-6 py-4 whitespace-nowrap">${s.ratio}</td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                    <button data-id="${s.id}" class="delete-split-btn text-red-600 hover:text-red-900">刪除</button>
                </td>
            </tr>
        `;
    }).join('');
}