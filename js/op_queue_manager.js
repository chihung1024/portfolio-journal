// =========================================================================================
// == 操作隊列管理器 (op_queue_manager.js) - 【新檔案】
// == 職責：統一管理 CUD 操作，執行前端預更新 (Optimistic Update)，並維護隊列狀態。
// =========================================================================================

import { getState, setState } from './state.js';
import { showNotification } from './ui/notifications.js';

/**
 * 更新 "同步" 按鈕的 UI 狀態
 */
function updateSyncButtonUI() {
    const { hasUnsyncedChanges } = getState();
    const syncBtn = document.getElementById('sync-changes-btn');
    const syncIndicator = document.getElementById('sync-indicator');

    if (syncBtn) {
        syncBtn.disabled = !hasUnsyncedChanges;
        syncBtn.classList.toggle('opacity-50', !hasUnsyncedChanges);
    }
    if (syncIndicator) {
        syncIndicator.classList.toggle('hidden', !hasUnsyncedChanges);
    }
}

/**
 * 在前端 state 中預先套用操作結果 (Optimistic Update)
 * @param {object} op - 操作物件 { op, entity, payload }
 */
function applyOptimisticUpdate(op) {
    const { op: operation, entity, payload } = op;
    const state = getState();

    try {
        switch (entity) {
            case 'transaction': {
                let transactions = [...state.transactions];
                if (operation === 'CREATE') {
                    // 為新交易分配一個臨時的前端 ID
                    const tempId = `temp_${Date.now()}`;
                    transactions.unshift({ ...payload, id: tempId, isTemporary: true });
                } else if (operation === 'UPDATE') {
                    transactions = transactions.map(t => t.id === payload.txId ? { ...t, ...payload.txData } : t);
                } else if (operation === 'DELETE') {
                    transactions = transactions.filter(t => t.id !== payload.txId);
                }
                setState({ transactions });
                break;
            }
            case 'split': {
                let userSplits = [...state.userSplits];
                 if (operation === 'CREATE') {
                    const tempId = `temp_${Date.now()}`;
                    userSplits.unshift({ ...payload, id: tempId, isTemporary: true });
                } else if (operation === 'DELETE') {
                    userSplits = userSplits.filter(s => s.id !== payload.splitId);
                }
                setState({ userSplits });
                break;
            }
            case 'user_dividend': {
                let confirmedDividends = [...state.confirmedDividends];
                if (operation === 'CREATE') {
                     const tempId = `temp_${Date.now()}`;
                     confirmedDividends.unshift({ ...payload, id: tempId, isTemporary: true });
                } else if (operation === 'UPDATE') {
                    confirmedDividends = confirmedDividends.map(d => d.id === payload.id ? { ...d, ...payload } : d);
                } else if (operation === 'DELETE') {
                    confirmedDividends = confirmedDividends.filter(d => d.id !== payload.dividendId);
                }
                setState({ confirmedDividends });
                break;
            }
            case 'stock_note': {
                 let stockNotes = { ...state.stockNotes };
                 stockNotes[payload.symbol] = { ...stockNotes[payload.symbol], ...payload };
                 setState({ stockNotes });
                 break;
            }
            case 'group': {
                let groups = [...state.groups];
                 if (operation === 'CREATE') {
                    const tempId = `temp_${Date.now()}`;
                    groups.unshift({ ...payload, id: tempId, isTemporary: true, symbols: [], transaction_count: payload.transactionIds.length });
                 } else if (operation === 'UPDATE') {
                    groups = groups.map(g => g.id === payload.id ? { ...g, ...payload, transaction_count: payload.transactionIds.length } : g);
                 } else if (operation === 'DELETE') {
                    groups = groups.filter(g => g.id !== payload.groupId);
                 }
                 setState({ groups });
                 break;
            }
        }
        return true;
    } catch (error) {
        console.error("Optimistic update failed:", error);
        showNotification('error', '前端狀態更新失敗，建議同步後刷新頁面。');
        return false;
    }
}

/**
 * 將一個新的操作加入到隊列中
 * @param {'CREATE' | 'UPDATE' | 'DELETE'} op - 操作類型
 * @param {string} entity - 操作的實體類型 (e.g., 'transaction', 'split')
 * @param {object} payload - 該操作所需的數據
 * @returns {boolean} - 操作是否成功加入
 */
export function addToQueue(op, entity, payload) {
    const { op_queue } = getState();
    
    // 執行前端預更新
    const optimisticUpdateSuccess = applyOptimisticUpdate({ op, entity, payload });
    
    if (optimisticUpdateSuccess) {
        // 只有在前端更新成功時，才將操作加入隊列
        const new_op_queue = [...op_queue, { op, entity, payload }];
        setState({ 
            op_queue: new_op_queue,
            hasUnsyncedChanges: true 
        });
        
        console.log('Operation added to queue:', { op, entity, payload });
        console.log('Current queue size:', new_op_queue.length);

        updateSyncButtonUI();
        return true;
    }
    return false;
}

/**
 * 清空操作隊列並更新 UI (通常在同步成功後呼叫)
 */
export function clearQueue() {
    setState({
        op_queue: [],
        hasUnsyncedChanges: false
    });
    updateSyncButtonUI();
    console.log('Operation queue has been cleared.');
}

/**
 * 初始化同步按鈕狀態
 */
export function initializeSyncStatus() {
    updateSyncButtonUI();
}