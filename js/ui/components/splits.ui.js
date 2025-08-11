// =========================================================================================
// == 拆股事件 UI 模組 (splits.ui.js)
// == 職責：處理拆股事件表格的渲染。
// =========================================================================================

import { getState } from '../../state.js';

export function renderSplitsTable() {
    const { userSplits } = getState();
    const tableBody = document.getElementById('splits-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    if (userSplits.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">沒有自定義拆股事件。</td></tr>`;
        return;
    }
    
    for (const s of userSplits) {
        const row = document.createElement('tr');
        row.className = "hover:bg-gray-50";
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">${s.date.split('T')[0]}</td>
            <td class="px-6 py-4 whitespace-nowrap font-medium">${s.symbol.toUpperCase()}</td>
            <td class="px-6 py-4 whitespace-nowrap">${s.ratio}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                <button data-id="${s.id}" class="delete-split-btn text-red-600 hover:text-red-900">刪除</button>
            </td>
        `;
        tableBody.appendChild(row);
    }
}
