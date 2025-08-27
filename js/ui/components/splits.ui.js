// =========================================================================================
// == 拆股事件 UI 模組 (splits.ui.js) v2.0 - 整合暫存區狀態
// =========================================================================================

import { getState } from '../../state.js';
import { stagingService } from '../../staging.service.js'; // 【核心修改】
import { selectCombinedSplits } from '../../selectors.js';

export async function renderSplitsTable() {
    const { userSplits } = getState();
    const tableBody = document.getElementById('splits-table-body');
    if (!tableBody) return;

    // 【核心修改】從 selector 獲取已合併的拆股事件列表
    const combinedSplits = await selectCombinedSplits();
    
    // 按日期重新排序
    combinedSplits.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (combinedSplits.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">沒有自定義拆股事件。</td></tr>`;
        return;
    }
    
    tableBody.innerHTML = combinedSplits.map(s => {
        // 【核心修改】根據暫存狀態決定背景色
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