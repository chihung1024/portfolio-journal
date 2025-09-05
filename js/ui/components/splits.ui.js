// js/ui/components/splits.ui.js

import state from '../../state.js';

export function renderSplitsTable() {
    const splits = state.splits || [];
    const container = document.getElementById('splits-table');
    if (!container) return;

    const sortedSplits = [...splits].sort((a, b) => new Date(b.date) - new Date(a.date));

    const tableHTML = `
        <div class="table-container">
            <table class="min-w-full">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-4 py-2 text-left">股票代號</th>
                        <th class="px-4 py-2 text-left">分割日期</th>
                        <th class="px-4 py-2 text-center">分割比例</th>
                        <th class="px-4 py-2 text-right">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedSplits.map(split => `
                        <tr class="border-b" data-id="${split.id}">
                            <td class="px-4 py-2">${split.symbol}</td>
                            <td class="px-4 py-2">${split.date}</td>
                            <td class="px-4 py-2 text-center">${split.from_factor} for ${split.to_factor}</td>
                            <td class="px-4 py-2 text-right">
                                <button class="edit-split-btn text-blue-500 hover:text-blue-700 p-1">
                                    <i data-lucide="edit" class="w-4 h-4"></i>
                                </button>
                                <button class="delete-split-btn text-red-500 hover:text-red-700 p-1">
                                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    if (sortedSplits.length === 0) {
        container.innerHTML = `<p>沒有股票分割資料。</p>`;
    } else {
        container.innerHTML = tableHTML;
        lucide.createIcons();
    }
}
