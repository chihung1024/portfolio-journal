// =========================================================================================
// == 暫存區事件處理模組 (staging.events.js) - v2.3 (Fix UI Refresh Flow)
// =========================================================================================

import { stagingService } from '../staging.service.js';
// 【核心修改】引入 submitBatch 和 updateAppWithData
import { submitBatch, updateAppWithData } from '../api.js';
import { showNotification } from '../ui/notifications.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';
import { renderSplitsTable } from '../ui/components/splits.ui.js';
import { renderGroupsTab } from '../ui/components/groups.ui.js';
import { getState } from '../state.js';

/**
 * 輔助函式，用於刷新當前可見的分頁視圖
 */
async function refreshCurrentView() {
    const activeTab = document.querySelector('.tab-content:not(.hidden)');
    if (!activeTab) return;

    await new Promise(resolve => setTimeout(resolve, 50));

    switch (activeTab.id) {
        case 'transactions-tab':
            await renderTransactionsTable();
            break;
        case 'dividends-tab':
            const { pendingDividends, confirmedDividends } = getState();
            await renderDividendsManagementTab(pendingDividends, confirmedDividends);
            break;
        case 'splits-tab':
            await renderSplitsTable();
            break;
        case 'groups-tab':
            await renderGroupsTab();
            break;
    }
}


/**
 * 格式化單個暫存操作，以便在 UI 中顯示
 */
function formatActionForDisplay(action) {
    const { type, entity, payload } = action;
    let title = '未知操作';
    let details = '';

    const typeMap = {
        'CREATE': { text: '新增', color: 'green', icon: 'plus-circle' },
        'UPDATE': { text: '更新', color: 'yellow', icon: 'edit-3' },
        'DELETE': { text: '刪除', color: 'red', icon: 'trash-2' }
    };
    const { text, color, icon } = typeMap[type] || { text: '未知', color: 'gray', icon: 'help-circle' };

    switch (entity) {
        case 'transaction':
            title = `${text}交易紀錄`;
            details = `[${payload.symbol}] ${payload.type === 'buy' ? '買入' : '賣出'} ${payload.quantity} 股 @ ${payload.price}`;
            break;
        case 'split':
            title = `${text}拆股事件`;
            details = `[${payload.symbol}] 比例: 1 變 ${payload.ratio}`;
            break;
        case 'dividend':
            title = `${text}配息紀錄`;
            details = `[${payload.symbol}] 發放日: ${payload.pay_date}, 實收: ${payload.total_amount}`;
            break;
        case 'group':
            title = `${text}群組`;
            details = `名稱: ${payload.name}`;
            break;
    }

    return `
        <div class="p-3 rounded-md border border-gray-200 flex items-center justify-between bg-${color}-50">
            <div class="flex items-center space-x-3">
                <i data-lucide="${icon}" class="w-5 h-5 text-${color}-600"></i>
                <div>
                    <p class="font-semibold text-sm text-gray-800">${title}</p>
                    <p class="text-xs text-gray-600">${details}</p>
                </div>
            </div>
            <button data-action-id="${action.id}" class="remove-staged-action-btn btn p-2 text-gray-400 hover:text-red-600">
                <i data-lucide="x-circle" class="w-5 h-5"></i>
            </button>
        </div>
    `;
}

/**
 * 渲染暫存區彈出視窗的內容
 */
async function renderStagingModal() {
    const container = document.getElementById('staging-list-container');
    const actions = await stagingService.getStagedActions();

    if (actions.length === 0) {
        container.innerHTML = `<p class="text-center py-10 text-gray-500">暫存區是空的。</p>`;
    } else {
        container.innerHTML = actions.map(formatActionForDisplay).join('');
    }
    lucide.createIcons();
}

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【重構】處理提交所有暫存操作的完整流程
 */
async function submitAllActions() {
    const { closeModal } = await import('../ui/modals.js');
    closeModal('staging-modal');

    try {
        // 1. 從暫存區獲取淨操作
        const netActions = await stagingService.getNetActions();
        if (netActions.length === 0) {
            showNotification('info', '沒有需要提交的操作。');
            return;
        }
        
        // 2. 呼叫 API 提交，並等待後端回傳最新的完整數據
        const result = await submitBatch(netActions);
        
        if (result.success) {
            // 3. 提交成功後，清空前端的暫存區
            await stagingService.clearActions();
            
            // 4. 使用後端回傳的最新、最完整的數據來更新整個 App 的 UI
            updateAppWithData(result.data, result.data.tempIdMap);
        }

    } catch (error) {
        // submitBatch 內部已經處理了錯誤通知，這裡只需記錄日誌
        console.error("提交暫存區時發生最終錯誤:", error);
    }
}
// ========================= 【核心修改 - 結束】 =========================


/**
 * 初始化所有與暫存區相關的事件監聽器
 */
export function initializeStagingEventListeners() {
    const editBtn = document.getElementById('edit-staging-btn');
    const submitAllBtn = document.getElementById('submit-all-btn');
    const stagingModal = document.getElementById('staging-modal');

    document.addEventListener('staging-area-updated', (e) => {
        const count = e.detail.count;
        const badge = document.getElementById('staging-count-badge');
        const controls = document.getElementById('staging-controls');
        
        badge.textContent = count;
        if (count > 0) {
            controls.classList.remove('hidden');
            controls.classList.add('flex');
        } else {
            controls.classList.add('hidden');
            controls.classList.remove('flex');
        }
    });

    editBtn.addEventListener('click', async () => {
        const { openModal } = await import('../ui/modals.js');
        await renderStagingModal();
        openModal('staging-modal');
    });

    submitAllBtn.addEventListener('click', submitAllActions);

    if (stagingModal) {
        stagingModal.addEventListener('click', async (e) => {
            const { closeModal, showConfirm } = await import('../ui/modals.js');
            if (e.target.closest('#close-staging-modal-btn')) {
                closeModal('staging-modal');
                return;
            }

            const removeBtn = e.target.closest('.remove-staged-action-btn');
            if (removeBtn) {
                const actionId = parseInt(removeBtn.dataset.actionId, 10);
                await stagingService.removeAction(actionId);
                await renderStagingModal();
                await refreshCurrentView();
                return;
            }

            if (e.target.closest('#submit-from-staging-btn')) {
                submitAllActions();
                return;
            }

            if (e.target.closest('#clear-staging-btn')) {
                showConfirm('您確定要清空所有暫存的操作嗎？此操作無法復原。', async () => {
                    await stagingService.clearActions();
                    await renderStagingModal();
                    await refreshCurrentView(); 
                    showNotification('info', '暫存區已清空。');
                });
                return;
            }
        });
    }
}
