// =========================================================================================
// == 配息管理 UI 模組 (dividends.ui.js) v2.1 - Defensive Render
// == 職責：渲染配息管理分頁的整體 UI。
// =========================================================================================

import { getState } from '../../state.js';
import { formatNumber, isTwStock } from '../utils.js';

function renderPendingDividends(pendingDividends) {
    const container = document.getElementById('pending-dividends-container');
    // ========================= 【核心修改 - 開始】 =========================
    if (!container) return; // 防禦性檢查，如果容器不存在則不執行
    // ========================= 【核心修改 - 結束】 =========================

    if (pendingDividends.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-4">沒有待確認的配息。</p>';
        const bulkBtn = document.getElementById('bulk-confirm-dividends-btn');
        if(bulkBtn) bulkBtn.classList.add('hidden');
        return;
    }

    const bulkBtn = document.getElementById('bulk-confirm-dividends-btn');
    if(bulkBtn) bulkBtn.classList.remove('hidden');

    const tableHeader = `
        <thead class="bg-gray-50">
            <tr>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">除息日</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th>
                <th scope="col" class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">每股配息</th>
                <th scope="col" class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">持有股數</th>
                <th scope="col" class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
        </thead>`;

    const tableBody = pendingDividends.map((div, index) => `
        <tr class="border-b border-gray-200">
            <td class="px-4 py-4 whitespace-nowrap text-sm">${div.ex_dividend_date.split('T')[0]}</td>
            <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold">${div.symbol}</td>
            <td class="px-4 py-4 whitespace-nowrap text-sm text-right">${formatNumber(div.amount_per_share, 4)} <span class="text-xs text-gray-400">${div.currency}</span></td>
            <td class="px-4 py-4 whitespace-nowrap text-sm text-right">${formatNumber(div.quantity_at_ex_date, isTwStock(div.symbol) ? 0 : 2)}</td>
            <td class="px-4 py-4 whitespace-nowrap text-center">
                <button data-index="${index}" class="confirm-dividend-btn btn-primary text-xs">確認</button>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200">${tableHeader}<tbody class="bg-white divide-y divide-gray-200">${tableBody}</tbody></table></div>`;
}

function renderConfirmedDividends(confirmedDividends) {
    const container = document.getElementById('confirmed-dividends-container');
    // ========================= 【核心修改 - 開始】 =========================
    if (!container) return; // 防禦性檢查，如果容器不存在則不執行
    // ========================= 【核心修改 - 結束】 =========================

    const { dividendFilter } = getState();
    const filteredDividends = dividendFilter
        ? confirmedDividends.filter(d => d.symbol.toUpperCase().includes(dividendFilter.toUpperCase()))
        : confirmedDividends;

    if (filteredDividends.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-4">沒有已確認的配息紀錄。</p>';
        return;
    }

    const tableHeader = `
        <thead class="bg-gray-50">
            <tr>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">發放日</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th>
                <th scope="col" class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">實收總額</th>
                <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">備註</th>
                <th scope="col" class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
            </tr>
        </thead>`;

    const tableBody = filteredDividends.map(div => {
        let rowClass = 'border-b border-gray-200';
        let statusBadge = '';
        let actionButtons = `
            <button data-id="${div.id}" class="edit-dividend-btn text-indigo-600 hover:text-indigo-900 text-sm font-medium">編輯</button>
            <button data-id="${div.id}" class="delete-dividend-btn text-red-600 hover:text-red-900 text-sm font-medium ml-3">刪除</button>
        `;

        switch (div.status) {
            case 'STAGED_UPDATE':
                rowClass += ' bg-blue-50';
                statusBadge = `<span class="ml-2 text-xs font-semibold italic text-blue-800">已修改</span>`;
                break;
            case 'STAGED_DELETE':
                rowClass += ' bg-red-50 opacity-60 line-through';
                statusBadge = `<span class="ml-2 text-xs font-semibold italic text-red-800">待刪除</span>`;
                actionButtons = `<button data-change-id="${div.changeId}" class="revert-change-btn text-gray-600 hover:text-gray-900 text-sm font-medium">復原</button>`;
                break;
        }

        return `
            <tr class="${rowClass}">
                <td class="px-4 py-4 whitespace-nowrap text-sm">${div.pay_date.split('T')[0]}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold">${div.symbol}${statusBadge}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-right">${formatNumber(div.total_amount, 2)} <span class="text-xs text-gray-400">${div.currency}</span></td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-600 truncate max-w-xs">${div.notes || ''}</td>
                <td class="px-4 py-4 whitespace-nowrap text-center">
                    ${actionButtons}
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200">${tableHeader}<tbody class="bg-white divide-y divide-gray-200">${tableBody}</tbody></table></div>`;
}

export function renderDividendsManagementTab(pending, confirmed) {
    renderPendingDividends(pending);
    renderConfirmedDividends(confirmed);
}
