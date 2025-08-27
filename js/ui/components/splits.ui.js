// =========================================================================================
// == 拆股事件 UI 模組 (splits.ui.js) v2.0 - 整合暫存區狀態
// =========================================================================================

import { getState } from '../../state.js';
import { stagingService } from '../../staging.service.js'; // 【核心修改】

export async function renderSplitsTable() {
    const { userSplits } = getState();
    const tableBody = document.getElementById('splits-table-body');
    if (!tableBody) return;

    // 【核心修改】從暫存區獲取拆股相關的操作
    const stagedActions = await stagingService.getStagedActions();
    const splitActions = stagedActions.filter(a => a.entity === 'split');
    const stagedActionMap = new Map();
    splitActions.forEach(action => {
        stagedActionMap.set(action.payload.id, action);
    });

    // 結合 state 中的數據和暫存區的數據
    let combinedSplits = [...userSplits];

    stagedActionMap.forEach((action, splitId) => {
        const existingIndex = combinedSplits.findIndex(s => s.id === splitId);
        
        if (action.type === 'CREATE') {
            if (existingIndex === -1) {
                combinedSplits.push({ ...action.payload, _staging_status: 'CREATE' });
            }
        } 
        // 拆股事件沒有更新(UPDATE)操作
        else if (action.type === 'DELETE') {
            if (existingIndex > -1) {
                combinedSplits[existingIndex]._staging_status = 'DELETE';
            }
        }
    });
    
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