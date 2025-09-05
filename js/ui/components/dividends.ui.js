// js/ui/components/dividends.ui.js

import state from '../../state.js';
import { formatCurrency } from '../utils.js';

export function renderDividendsTable() {
    const dividends = state.dividends || [];
    const container = document.getElementById('dividends-table');
    if (!container) return;

    // Sort dividends by date descending
    const sortedDividends = [...dividends].sort((a, b) => new Date(b.date) - new Date(a.date));

    const tableHTML = `
        <div class="table-container">
            <table class="min-w-full">
                <thead class="bg-gray-100">
                    <tr>
                        <th class="px-4 py-2 text-left">股票代號</th>
                        <th class="px-4 py-2 text-left">除息日</th>
                        <th class="px-4 py-2 text-right">每股股息</th>
                        <th class="px-4 py-2 text-right">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedDividends.map(dividend => `
                        <tr class="border-b" data-id="${dividend.id}">
                            <td class="px-4 py-2">${dividend.symbol}</td>
                            <td class="px-4 py-2">${dividend.date}</td>
                            <td class="px-4 py-2 text-right">${formatCurrency(dividend.amount)}</td>
                            <td class="px-4 py-2 text-right">
                                <button class="edit-dividend-btn text-blue-500 hover:text-blue-700 p-1">
                                    <i data-lucide="edit" class="w-4 h-4"></i>
                                </button>
                                <button class="delete-dividend-btn text-red-500 hover:text-red-700 p-1">
                                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    if (sortedDividends.length === 0) {
        container.innerHTML = `<p>沒有股息資料。</p>`;
    } else {
        container.innerHTML = tableHTML;
        lucide.createIcons();
    }
}
