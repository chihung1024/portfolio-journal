// =========================================================================================
// == 檔案：js/selectors.js (v1.0) - 【新檔案】
// == 職責：作為前端的單一數據源 (SSoT)，提供合併 state 與暫存區數據後的最終結果。
// =========================================================================================

import { getState } from './state.js';
import { stagingService } from './staging.service.js';

/**
 * 輔助函式：將暫存區的操作應用於一個實體陣列上
 * @param {Array} baseArray - 來自 state 的原始陣列
 * @param {Array} stagedActions - 來自暫存區的相關操作
 * @returns {Array} - 合併了暫存區變更後的最終陣列
 */
function applyStaging(baseArray, stagedActions) {
    let combined = [...baseArray];
    const stagedActionMap = new Map();

    // 為了處理更新和刪除，先將所有實體放入一個 map 中以便快速查找
    const combinedMap = new Map(combined.map(item => [item.id, item]));

    stagedActions.forEach(action => {
        const { type, payload } = action;
        const entityId = payload.id;

        if (type === 'CREATE') {
            // 新增操作直接加入
            if (!combinedMap.has(entityId)) {
                combinedMap.set(entityId, { ...payload, _staging_status: 'CREATE' });
            }
        } else if (type === 'UPDATE') {
            // 更新操作，如果存在則合併，不存在則視為新增
            if (combinedMap.has(entityId)) {
                const existing = combinedMap.get(entityId);
                combinedMap.set(entityId, { ...existing, ...payload, _staging_status: 'UPDATE' });
            } else {
                combinedMap.set(entityId, { ...payload, _staging_status: 'CREATE' });
            }
        } else if (type === 'DELETE') {
            // 刪除操作，如果存在則標記
            if (combinedMap.has(entityId)) {
                const existing = combinedMap.get(entityId);
                combinedMap.set(entityId, { ...existing, _staging_status: 'DELETE' });
            }
        }
    });
    
    return Array.from(combinedMap.values());
}

/**
 * Selector: 獲取合併暫存狀態後的交易紀錄列表
 * @returns {Promise<Array>}
 */
export async function selectCombinedTransactions() {
    const { transactions } = getState();
    const allStagedActions = await stagingService.getStagedActions();
    const transactionActions = allStagedActions.filter(a => a.entity === 'transaction');
    
    const combined = applyStaging(transactions, transactionActions);
    
    // 按日期降序排序
    combined.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return combined;
}

/**
 * Selector: 獲取合併暫存狀態後的群組列表
 * @returns {Promise<Array>}
 */
export async function selectCombinedGroups() {
    const { groups } = getState();
    const allStagedActions = await stagingService.getStagedActions();
    const groupActions = allStagedActions.filter(a => a.entity === 'group');

    const combined = applyStaging(groups, groupActions);
    
    // 按創建時間降序排序 (如果有的話)
    combined.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    
    return combined;
}

/**
 * Selector: 獲取合併暫存狀態後的已確認配息列表
 * @returns {Promise<Array>}
 */
export async function selectCombinedConfirmedDividends() {
    const { confirmedDividends } = getState();
    const allStagedActions = await stagingService.getStagedActions();
    const dividendActions = allStagedActions.filter(a => a.entity === 'dividend');

    const combined = applyStaging(confirmedDividends, dividendActions);
    
    // 按發放日降序排序
    combined.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));

    return combined;
}

/**
 * Selector: 獲取合併暫存狀態後的拆股事件列表
 * @returns {Promise<Array>}
 */
export async function selectCombinedSplits() {
    const { userSplits } = getState();
    const allStagedActions = await stagingService.getStagedActions();
    const splitActions = allStagedActions.filter(a => a.entity === 'split');
    
    const combined = applyStaging(userSplits, splitActions);
    
    // 按日期降序排序
    combined.sort((a, b) => new Date(b.date) - new Date(a.date));

    return combined;
}