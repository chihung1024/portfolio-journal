// =========================================================================================
// == 檔案：js/ui/components/splits.ui.js (v_arch_cleanup_final_s1)
// == 職責：渲染股票分割的列表，並遵循正確的狀態管理規範
// =========================================================================================

import { getSplits } from '../../state.js'; // 【核心修正】: 導入職責明確的 getSplits 函式
import { formatDate } from '../utils.js';

/**
 * 渲染股票分割列表
 * @param {HTMLElement} container - 用於渲染內容的 HTML 元素
 */
function renderSplits(container) {
    if (!container) return;

    // 【核心修正】: 直接呼叫 getSplits()，不再使用已廢棄的 getState
    const splits = getSplits();

    if (!splits || splits.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 py-4">沒有股票分割紀錄。</p>`;
        return;
    }

    const tableRows = splits.map(split => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${split.symbol}</td>
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${formatDate(split.ex_date)}</td>
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600">${split.from_factor} → ${split.to_factor}</td>
            <td class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-center">
                <button class="edit-split-btn text-blue-500 hover:text-blue-700 mr-2" data-id='${split.id}'><i class="fas fa-edit"></i></button>
                <button class="delete-split-btn text-red-500 hover:text-red-700" data-id='${split.id}'><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full bg-white dark:bg-gray-800 text-sm">
                <thead class="bg-gray-100 dark:bg-gray-700">
                    <tr>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">代碼</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">除權日</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-left">分割比例</th>
                        <th class="py-2 px-4 border-b border-gray-200 dark:border-gray-600 text-center">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
}

export {
    renderSplits
};
