// =========================================================================================
// == 配息管理 UI 模組 (dividends.ui.js) v2.0 - 整合暫存區狀態
// =========================================================================================

import { getState } from '../../state.js';
import { stagingService } from '../../staging.service.js'; // 【核心修改】
import { isTwStock, formatNumber } from '../utils.js';
import { selectCombinedConfirmedDividends } from '../../selectors.js';

export async function renderDividendsManagementTab(pending, confirmed) {
    const { dividendFilter } = getState();
    const container = document.getElementById('dividends-tab');

    // 【核心修改】從 selector 獲取已合併的已確認配息列表
    const combinedConfirmed = await selectCombinedConfirmedDividends();
    
    // 重新按發放日排序
    combinedConfirmed.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));


    const pendingHtml = `<div class="mb-8"><div class="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4"><h3 class="text-lg font-semibold text-gray-800">待確認配息</h3>${pending.length > 0 ? `<button id="bulk-confirm-dividends-btn" class="btn bg-teal-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-teal-700 flex items-center space-x-2"><i data-lucide="check-check" class="h-5 w-5"></i><span>一鍵全部以預設值確認</span></button>` : ''}</div><div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">除息日</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">當時股數</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">每股配息</th><th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${pending.length > 0 ? pending.map((p, index) => `<tr class="hover:bg-gray-50"><td class="px-4 py-4 font-medium">${p.symbol}</td><td class="px-4 py-4">${p.ex_dividend_date}</td><td class="px-4 py-4">${formatNumber(p.quantity_at_ex_date, isTwStock(p.symbol) ? 0 : 2)}</td><td class="px-4 py-4">${formatNumber(p.amount_per_share, 4)} <span class="text-xs text-gray-500">${p.currency}</span></td><td class="px-4 py-4 text-center"><button data-index="${index}" class="confirm-dividend-btn text-indigo-600 hover:text-indigo-900 font-medium">確認入帳</button></td></tr>`).join('') : `<tr><td colspan="5" class="text-center py-10 text-gray-500">沒有待處理的配息。</td></tr>`}</tbody></table></div></div>`;
    
    const confirmedSymbols = ['all', ...Array.from(new Set(combinedConfirmed.map(c => c.symbol)))];
    const filterHtml = `<div class="mb-4 flex items-center space-x-2"><label for="dividend-symbol-filter" class="text-sm font-medium text-gray-700">篩選股票:</label><select id="dividend-symbol-filter" class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">${confirmedSymbols.map(s => `<option value="${s}" ${dividendFilter === s ? 'selected' : ''}>${s === 'all' ? '顯示全部' : s}</option>`).join('')}</select></div>`;
    
    const filteredConfirmed = dividendFilter === 'all' ? combinedConfirmed : combinedConfirmed.filter(c => c.symbol === dividendFilter);
    
    const confirmedHtml = `<div><h3 class="text-lg font-semibold text-gray-800 mb-4">已確認 / 歷史配息</h3>${filterHtml}<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">發放日</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">代碼</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">實收總額</th><th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">備註</th><th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th></tr></thead><tbody class="bg-white divide-y divide-gray-200">${filteredConfirmed.length > 0 ? filteredConfirmed.map((c) => {
        // 【核心修改】根據暫存狀態決定背景色
        let stagingClass = '';
        if (c._staging_status === 'CREATE') stagingClass = 'bg-staging-create';
        else if (c._staging_status === 'UPDATE') stagingClass = 'bg-staging-update';
        else if (c._staging_status === 'DELETE') stagingClass = 'bg-staging-delete opacity-70';

        return `<tr class="${stagingClass}"><td class="px-4 py-4">${c.pay_date.split('T')[0]}</td><td class="px-4 py-4 font-medium">${c.symbol}</td><td class="px-4 py-4">${formatNumber(c.total_amount, c.currency === 'TWD' ? 0 : 2)} <span class="text-xs text-gray-500">${c.currency}</span></td><td class="px-4 py-4 text-sm text-gray-600 truncate max-w-xs">${c.notes || ''}</td><td class="px-4 py-4 text-center"><button data-id="${c.id}" class="edit-dividend-btn text-indigo-600 hover:text-indigo-900 mr-3">編輯</button><button data-id="${c.id}" class="delete-dividend-btn text-red-600 hover:text-red-900">刪除</button></td></tr>`;
    }).join('') : `<tr><td colspan="5" class="text-center py-10 text-gray-500">沒有符合條件的已確認配息紀錄。</td></tr>`}</tbody></table></div></div>`;
    
    container.innerHTML = pendingHtml + confirmedHtml;
    lucide.createIcons();
}