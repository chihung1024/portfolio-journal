// =========================================================================================
// == 拆股 UI 模組 (splits.ui.js) v2.0 - Staging-Ready
// == 職責：渲染拆股管理分頁的 UI。
// =========================================================================================

import { getState } from '../../state.js';

export function renderSplitsTable() {
    const { userSplits } = getState();
    const container = document.getElementById('splits-list-container');
    if (!container) return;

    if (!userSplits || userSplits.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-4">沒有拆股紀錄。</p>';
        return;
    }

    const tableHeader = `
        <thead class="bg-gray-50">
            <tr>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th>
                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">比例</th>
                <th scope="col" class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
        </thead>`;

    // ========================= 【核心修改 - 開始】 =========================
    const tableBody = userSplits.map(split => {
        let rowClass = 'border-b border-gray-200';
        let statusBadge = '';
        let actionButtons = `<button data-id="${split.id}" class="delete-split-btn text-red-600 hover:text-red-900 text-sm font-medium">刪除</button>`;

        switch (split.status) {
            case 'STAGED_CREATE':
                rowClass += ' bg-yellow-50';
                statusBadge = `<span class="ml-2 text-xs font-semibold italic text-yellow-800">暫存中</span>`;
                actionButtons = `<button data-change-id="${split.changeId}" class="revert-change-btn text-gray-600 hover:text-gray-900 text-sm font-medium">復原</button>`;
                break;
            case 'STAGED_DELETE':
                rowClass += ' bg-red-50 opacity-60 line-through';
                statusBadge = `<span class="ml-2 text-xs font-semibold italic text-red-800">待刪除</span>`;
                actionButtons = `<button data-change-id="${split.changeId}" class="revert-change-btn text-gray-600 hover:text-gray-900 text-sm font-medium">復原</button>`;
                break;
        }

        return `
            <tr class="${rowClass}">
                <td class="px-6 py-4 whitespace-nowrap text-sm">${split.date.split('T')[0]}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold">${split.symbol}${statusBadge}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">1 : ${split.ratio}</td>
                <td class="px-6 py-4 whitespace-nowrap text-center">
                    ${actionButtons}
                </td>
            </tr>
        `;
    }).join('');
    // ========================= 【核心修改 - 結束】 =========================

    container.innerHTML = `<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200">${tableHeader}<tbody class="bg-white divide-y divide-gray-200">${tableBody}</tbody></table></div>`;
}