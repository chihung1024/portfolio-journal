// =========================================================================================
// == 數據選擇器模組 (selectors.js) - 【新檔案】
// == 職責：作為前端數據的唯一出口，封裝 state 與暫存區數據的合併邏輯。
// =========================================================================================

import { getState } from './state.js';
import { stagingService } from './staging.service.js';

/**
 * 輔助函式：合併 state 中的原始數據與暫存區中的操作
 * @param {Array} baseData - 來自 state 的原始數據陣列
 * @param {Array} stagedActions - 來自暫存區的操作陣列
 * @returns {Array} - 合併並處理後的最終數據陣列
 */
function mergeStagedData(baseData, stagedActions) {
    const stagedActionMap = new Map();
    stagedActions.forEach(action => {
        stagedActionMap.set(action.payload.id, action);
    });

    let combinedData = [...baseData];

    stagedActionMap.forEach((action, id) => {
        const existingIndex = combinedData.findIndex(item => item.id === id);

        if (action.type === 'CREATE') {
            if (existingIndex === -1) {
                combinedData.push({ ...action.payload, _staging_status: 'CREATE' });
            }
        } else if (action.type === 'UPDATE') {
            if (existingIndex > -1) {
                combinedData[existingIndex] = { ...combinedData[existingIndex], ...action.payload, _staging_status: 'UPDATE' };
            }
        } else if (action.type === 'DELETE') {
            if (existingIndex > -1) {
                combinedData[existingIndex]._staging_status = 'DELETE';
            }
        }
    });

    // 處理因暫存區更新而產生的新項目，但其 ID 可能不存在於原始列表中
    stagedActions.filter(a => a.type === 'UPDATE' && !baseData.some(item => item.id === a.payload.id))
        .forEach(action => {
            combinedData.push({ ...action.payload, _staging_status: 'CREATE' });
        });

    return combinedData;
}


/**
 * 選擇器：獲取已合併的交易紀錄列表
 */
export async function selectCombinedTransactions() {
    const { transactions } = getState();
    const stagedActions = await stagingService.getStagedActions();
    const transactionActions = stagedActions.filter(a => a.entity === 'transaction');

    const combined = mergeStagedData(transactions, transactionActions);
    combined.sort((a, b) => new Date(b.date) - new Date(a.date));

    return combined;
}

/**
 * 選擇器：獲取已合併的群組列表
 */
export async function selectCombinedGroups() {
    const { groups } = getState();
    const stagedActions = await stagingService.getStagedActions();
    const groupActions = stagedActions.filter(a => a.entity === 'group');
    
    const combined = mergeStagedData(groups, groupActions);
    combined.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    return combined;
}

/**
 * 選擇器：獲取已合併的已確認配息列表
 */
export async function selectCombinedConfirmedDividends() {
    const { confirmedDividends } = getState();
    const stagedActions = await stagingService.getStagedActions();
    const dividendActions = stagedActions.filter(a => a.entity === 'dividend');

    const combined = mergeStagedData(confirmedDividends, dividendActions);
    combined.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));

    return combined;
}

/**
 * 選擇器：獲取已合併的拆股事件列表
 */
export async function selectCombinedSplits() {
    const { userSplits } = getState();
    const stagedActions = await stagingService.getStagedActions();
    const splitActions = stagedActions.filter(a => a.entity === 'split');

    const combined = mergeStagedData(userSplits, splitActions);
    combined.sort((a, b) => new Date(b.date) - new Date(a.date));

    return combined;
}