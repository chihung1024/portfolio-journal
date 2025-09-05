// js/ui/components/staging.ui.js

import { stagingService } from '../../staging.service.js';

/**
 * 渲染暫存區主介面
 */
export async function renderStagingArea() {
    const container = document.getElementById('staging-content');
    if (!container) {
        console.error("Staging area container 'staging-content' not found.");
        return;
    }

    container.innerHTML = '<p class="text-center py-10 text-gray-500">正在加載暫存區資料...</p>';

    try {
        const actions = await stagingService.getStagedActions();

        if (actions.length === 0) {
            container.innerHTML = `
                <div class="p-4 text-center text-gray-500">
                    <h3 class="text-lg font-medium text-gray-700 mb-2">暫存區為空</h3>
                    <p>目前沒有待審核的變更。</p>
                </div>`;
            return;
        }

        container.innerHTML = `
            <div class="staging-controls mb-4 p-4 bg-gray-50 rounded-lg shadow-sm">
                <button id="commit-staged-btn" class="btn btn-primary w-full md:w-auto">提交選定項目</button>
                <p class="text-sm text-gray-600 mt-2">請檢視以下變更，勾選要執行的項目後點擊提交。</p>
            </div>
            <div class="space-y-3 staging-action-list">
                ${actions.map(action => renderActionCard(action)).join('')}
            </div>
        `;
        lucide.createIcons();

    } catch (error) {
        console.error('Failed to render staging area:', error);
        container.innerHTML = `<p class="text-center py-10 text-red-500">加載暫存區資料失敗：${error.message}</p>`;
    }
}

/**
 * 渲染單個暫存操作卡片
 * @param {object} action - 暫存的操作物件
 * @returns {string} HTML string for the action card
 */
function renderActionCard(action) {
    const { id, type, entity, payload } = action;
    const details = formatActionDetails(type, entity, payload);

    let bgColorClass = 'bg-white';
    let typeColorClass = 'text-gray-700';
    let typeText = type;

    switch (type) {
        case 'CREATE':
            bgColorClass = 'bg-staging-create border-green-200';
            typeColorClass = 'text-green-700 font-bold';
            typeText = '新增';
            break;
        case 'UPDATE':
            bgColorClass = 'bg-staging-update border-blue-200';
            typeColorClass = 'text-blue-700 font-bold';
            typeText = '更新';
            break;
        case 'DELETE':
            bgColorClass = 'bg-staging-delete border-red-200';
            typeColorClass = 'text-red-700 font-bold';
            typeText = '刪除';
            break;
    }

    return `
        <div class="action-card flex items-center p-3 border rounded-lg shadow-sm ${bgColorClass}">
            <div class="mr-3">
                <input type="checkbox" class="action-checkbox h-5 w-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" data-action-id="${id}">
            </div>
            <div class="flex-grow">
                <div class="flex justify-between items-start mb-1">
                    <span class="text-sm font-semibold ${typeColorClass}">${typeText}: ${details.entityName}</span>
                    <span class="text-xs text-gray-500">${new Date(action.created_at).toLocaleString()}</span>
                </div>
                <p class="text-sm text-gray-800">${details.summary}</p>
            </div>
            <div class="ml-4 flex-shrink-0">
                <button class="discard-action-btn btn p-2 text-gray-400 hover:text-red-600" data-action-id="${id}">
                    <i data-lucide="x-circle" class="w-5 h-5"></i>
                </button>
            </div>
        </div>
    `;
}

/**
 * 格式化操作細節以便顯示
 * @param {string} type - 操作類型 (CREATE, UPDATE, DELETE)
 * @param {string} entity - 實體類型 (e.g., 'group', 'transaction')
 * @param {object} payload - 操作的資料負載
 * @returns {{entityName: string, summary: string}}
 */
function formatActionDetails(type, entity, payload) {
    let entityName = entity;
    let summary = '';

    switch (entity) {
        case 'group':
            entityName = '群組';
            summary = `名稱: ${payload.name || 'N/A'}`;
            if (payload.description) summary += `, 描述: ${payload.description.substring(0, 30)}...`;
            break;
        case 'transaction':
            entityName = '交易紀錄';
            summary = `${payload.date} | ${payload.symbol} | ${payload.type} | ${payload.quantity} @ ${payload.price}`;
            break;
        // Add more cases for other entities like dividend, split if needed
        default:
            summary = JSON.stringify(payload);
    }

    return { entityName, summary };
}
