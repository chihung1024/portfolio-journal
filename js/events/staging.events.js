// =========================================================================================
// == 暫存區事件處理模組 (staging.events.js) v2.1 - API匯入修復
// =========================================================================================

import { stagingService } from '../staging.service.js';
import { showNotification } from '../ui/notifications.js';
import { openModal, closeModal } from '../ui/modals.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { renderDividendsTable } from '../ui/components/dividends.ui.js';
import { renderSplitsTable } from '../ui/components/splits.ui.js';
import { loadGroups } from './group.events.js';
import { getState } from '../state.js';

// ========================= 【修復：API匯入】 =========================
// 修正：使用正確的API函數名稱
import { executeBatchApiActions, executeApiAction } from '../api.js';
// ========================= 【修復完成】 =========================

/**
 * 提交所有暫存的操作
 */
export async function submitAllStagedActions() {
    try {
        const actions = await stagingService.getStagedActions();
        if (actions.length === 0) {
            showNotification('info', '沒有待提交的暫存操作');
            return;
        }

        showNotification('info', `開始提交 ${actions.length} 筆暫存操作...`);

        // ========================= 【修復：使用正確的批次函數】 =========================
        // 將暫存操作轉換為API批次操作格式
        const batchActions = actions.map(action => ({
            endpoint: getEndpointForAction(action),
            data: prepareDataForAction(action),
            actionId: action.id
        }));

        // 使用正確的批次執行函數
        const result = await executeBatchApiActions(batchActions, {
            loadingText: '正在批次提交暫存操作...',
            successMessage: '所有暫存操作已成功提交！',
            stopOnError: false,
            progressCallback: (current, total, action) => {
                console.log(`提交進度: ${current + 1}/${total} - ${action.endpoint}`);
            }
        });
        // ========================= 【修復完成】 =========================

        if (result.success) {
            // 清空暫存區
            await stagingService.clear();
            
            // 刷新相關數據
            await refreshAllData();
            
            showNotification('success', `成功提交 ${result.successCount}/${result.totalCount} 筆操作`);
        } else {
            const failedCount = result.errors.length;
            showNotification('warning', `部分操作失敗：${result.successCount}/${result.totalCount} 成功，${failedCount} 失敗`);
            
            // 只保留失敗的操作在暫存區
            const failedActionIds = result.errors.map(error => error.actionId);
            await stagingService.removeSuccessfulActions(failedActionIds);
        }

    } catch (error) {
        console.error('批次提交失敗:', error);
        showNotification('error', `批次提交失敗: ${error.message}`);
    }
}

/**
 * 根據暫存操作類型獲取對應的API端點
 */
function getEndpointForAction(action) {
    const { type, entity } = action;
    
    switch (entity) {
        case 'transaction':
            if (type === 'CREATE') return 'create_transaction';
            if (type === 'UPDATE') return 'update_transaction';
            if (type === 'DELETE') return 'delete_transaction';
            break;
            
        case 'group':
            if (type === 'CREATE') return 'create_group';
            if (type === 'UPDATE') return 'update_group';
            if (type === 'DELETE') return 'delete_group';
            break;
            
        case 'dividend':
            if (type === 'CREATE') return 'create_dividend';
            if (type === 'UPDATE') return 'update_dividend';
            if (type === 'DELETE') return 'delete_dividend';
            break;
            
        case 'split':
            if (type === 'CREATE') return 'create_split';
            if (type === 'UPDATE') return 'update_split';
            if (type === 'DELETE') return 'delete_split';
            break;
    }
    
    throw new Error(`未知的操作類型: ${entity}.${type}`);
}

/**
 * 為API操作準備數據
 */
function prepareDataForAction(action) {
    const { payload, entity, type } = action;
    
    // 處理特殊操作
    if (payload._special_action === 'CREATE_TX_WITH_ATTRIBUTION') {
        return {
            ...payload,
            // 移除特殊標記
            _special_action: undefined
        };
    }
    
    // 為更新和刪除操作添加ID
    if ((type === 'UPDATE' || type === 'DELETE') && payload.id) {
        return {
            ...payload,
            [`${entity}Id`]: payload.id
        };
    }
    
    return payload;
}

/**
 * 刷新所有相關數據
 */
async function refreshAllData() {
    try {
        // 觸發數據重新載入事件
        const refreshEvent = new CustomEvent('refreshAllData');
        document.dispatchEvent(refreshEvent);
        
        // 重新載入特定數據
        await Promise.all([
            renderTransactionsTable(),
            renderDividendsTable?.(),
            renderSplitsTable?.(),
            loadGroups()
        ]);
        
    } catch (error) {
        console.warn('刷新數據時發生錯誤:', error);
    }
}

/**
 * 清空所有暫存操作
 */
export async function clearAllStagedActions() {
    try {
        const actions = await stagingService.getStagedActions();
        if (actions.length === 0) {
            showNotification('info', '暫存區已經是空的');
            return;
        }

        // 顯示確認對話框
        const confirmed = await new Promise(resolve => {
            const confirmMessage = `確定要清空所有 ${actions.length} 筆暫存操作嗎？此操作無法復原。`;
            showConfirm(confirmMessage, () => resolve(true), '確認清空暫存區', () => resolve(false));
        });

        if (confirmed) {
            await stagingService.clear();
            showNotification('success', '已清空所有暫存操作');
            
            // 刷新界面
            await refreshAllData();
        }
        
    } catch (error) {
        console.error('清空暫存區失敗:', error);
        showNotification('error', `清空暫存區失敗: ${error.message}`);
    }
}

/**
 * 移除特定的暫存操作
 */
export async function removeStagedAction(actionId) {
    try {
        await stagingService.removeAction(actionId);
        showNotification('success', '已移除暫存操作');
        
        // 刷新界面
        await refreshAllData();
        
    } catch (error) {
        console.error('移除暫存操作失敗:', error);
        showNotification('error', `移除操作失敗: ${error.message}`);
    }
}

/**
 * 編輯暫存操作
 */
export async function editStagedAction(actionId) {
    try {
        const action = await stagingService.getAction(actionId);
        if (!action) {
            showNotification('error', '找不到指定的暫存操作');
            return;
        }

        // 根據操作類型開啟對應的編輯界面
        switch (action.entity) {
            case 'transaction':
                openModal('transaction-modal', true, action.payload);
                break;
            case 'group':
                openModal('group-modal', true, action.payload);
                break;
            case 'dividend':
                openModal('dividend-modal', true, action.payload);
                break;
            case 'split':
                openModal('split-modal', true, action.payload);
                break;
            default:
                showNotification('error', '不支援編輯此類型的暫存操作');
        }
        
    } catch (error) {
        console.error('編輯暫存操作失敗:', error);
        showNotification('error', `編輯操作失敗: ${error.message}`);
    }
}

/**
 * 獲取暫存操作統計信息
 */
export async function getStagingStats() {
    try {
        const actions = await stagingService.getStagedActions();
        
        const stats = {
            total: actions.length,
            byEntity: {},
            byType: {},
            oldestTimestamp: null,
            newestTimestamp: null
        };

        actions.forEach(action => {
            // 按實體類型統計
            stats.byEntity[action.entity] = (stats.byEntity[action.entity] || 0) + 1;
            
            // 按操作類型統計
            stats.byType[action.type] = (stats.byType[action.type] || 0) + 1;
            
            // 時間統計
            const timestamp = new Date(action.timestamp);
            if (!stats.oldestTimestamp || timestamp < stats.oldestTimestamp) {
                stats.oldestTimestamp = timestamp;
            }
            if (!stats.newestTimestamp || timestamp > stats.newestTimestamp) {
                stats.newestTimestamp = timestamp;
            }
        });

        return stats;
        
    } catch (error) {
        console.error('獲取暫存統計失敗:', error);
        return null;
    }
}

/**
 * 匯出暫存操作（用於備份或調試）
 */
export async function exportStagedActions() {
    try {
        const actions = await stagingService.getStagedActions();
        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            actionsCount: actions.length,
            actions: actions
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `staging-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification('success', `已匯出 ${actions.length} 筆暫存操作`);
        
    } catch (error) {
        console.error('匯出暫存操作失敗:', error);
        showNotification('error', `匯出失敗: ${error.message}`);
    }
}

// ========================= 【修復：確認對話框函數】 =========================
/**
 * 顯示確認對話框
 */
function showConfirm(message, confirmCallback, title = '確認操作', cancelCallback = null) {
    // 如果沒有全域的 showConfirm 函數，則創建一個簡單的實現
    if (typeof window.showConfirm === 'function') {
        window.showConfirm(message, confirmCallback, title, cancelCallback);
    } else {
        // 回退到原生確認對話框
        const confirmed = confirm(`${title}\n\n${message}`);
        if (confirmed) {
            confirmCallback();
        } else if (cancelCallback) {
            cancelCallback();
        }
    }
}
// ========================= 【修復完成】 =========================

// 初始化暫存區事件監聽器
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Staging Events] 暫存區事件處理器已初始化');
});

// 監聽全域數據刷新事件
document.addEventListener('refreshAllData', async () => {
    console.log('[Staging Events] 收到數據刷新事件');
    await refreshAllData();
});
