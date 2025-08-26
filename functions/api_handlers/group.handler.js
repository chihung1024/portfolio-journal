// =========================================================================================
// == 檔案：functions/api_handlers/group.handler.js (v3.1 - Refactored for Staging)
// == 職責：處理所有與群組讀取和按需計算相關的 API Action。CUD 操作已移至 staging.handler。
// =========================================================================================

const { d1Client } = require('../d1.client');
const { runCalculationEngine } = require('../calculation/engine');
// 【移除】不再需要 uuid
// const { v4: uuidv4 } = require('uuid');


/**
 * 【保留】獲取使用者建立的所有群組
 */
exports.getGroups = async (uid, res) => {
    const groupsResult = await d1Client.query('SELECT * FROM groups WHERE uid = ? ORDER BY created_at DESC', [uid]);
    const inclusionsResult = await d1Client.query('SELECT g.group_id, t.symbol FROM group_transaction_inclusions g JOIN transactions t ON g.transaction_id = t.id WHERE g.uid = ?', [uid]);

    const groupMap = {};
    groupsResult.forEach(group => {
        groupMap[group.id] = { ...group, symbols: new Set(), transaction_count: 0 };
    });

    inclusionsResult.forEach(inc => {
        if (groupMap[inc.group_id]) {
            groupMap[inc.group_id].symbols.add(inc.symbol);
            groupMap[inc.group_id].transaction_count++;
        }
    });

    const finalGroups = Object.values(groupMap).map(g => ({
        ...g,
        symbols: Array.from(g.symbols)
    }));

    return res.status(200).send({
        success: true,
        data: finalGroups
    });
};

/**
 * 【保留】獲取單一特定群組的詳細資訊 (包含成員ID)
 */
exports.getGroupDetails = async (uid, data, res) => {
    const { groupId } = data;
    if (!groupId) {
        return res.status(400).send({ success: false, message: '缺少 groupId。' });
    }

    const [groupInfoResult, inclusionIdsResult] = await Promise.all([
        d1Client.query('SELECT * FROM groups WHERE id = ? AND uid = ?', [groupId, uid]),
        d1Client.query('SELECT transaction_id FROM group_transaction_inclusions WHERE group_id = ? AND uid = ?', [groupId, uid])
    ]);

    if (groupInfoResult.length === 0) {
        return res.status(404).send({ success: false, message: '找不到指定的群組。' });
    }

    const groupDetails = {
        ...groupInfoResult[0],
        included_transaction_ids: inclusionIdsResult.map(row => row.transaction_id)
    };

    return res.status(200).send({ success: true, data: groupDetails });
};

/**
 * 【保留】獲取單一交易紀錄的群組歸屬情況
 */
exports.getTransactionMemberships = async (uid, data, res) => {
    const { transactionId } = data;
    if (!transactionId) {
        return res.status(400).send({ success: false, message: '缺少 transactionId。' });
    }
    const results = await d1Client.query(
        'SELECT group_id FROM group_transaction_inclusions WHERE transaction_id = ? AND uid = ?',
        [transactionId, uid]
    );
    const groupIds = results.map(row => row.group_id);
    return res.status(200).send({ success: true, data: { groupIds } });
};

// ========================= 【核心修改 - 開始】 =========================

// 【移除】saveGroup 函式
// 理由：新增/編輯群組的操作現在由前端發起 'stage_change' API，
//       並由 staging.handler.js 的 'commitAllChanges' 統一處理。
/*
exports.saveGroup = async (uid, data, res) => { ... };
*/

// 【移除】deleteGroup 函式
// 理由：刪除群組的操作也將由 staging area 統一管理。
/*
exports.deleteGroup = async (uid, data, res) => { ... };
*/

// 【移除】updateTransactionGroupMembership 函式
// 理由：更新交易歸屬的操作也將由 staging area 統一管理。
/*
exports.updateTransactionGroupMembership = async (uid, data, res) => { ... };
*/

// ========================= 【核心修改 - 結束】 =========================


/**
 * 【保留】按需計算指定群組的投資組合狀態（一次性，不儲存主資料）
 */
exports.calculateGroupOnDemand = async (uid, data, res) => {
    const { groupId } = data;
    if (!groupId) {
        return res.status(400).send({ success: false, message: '缺少 groupId。' });
    }

    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 按需計算程序開始 (v3 - 快取優先) ---`);

    const groupStatusResult = await d1Client.query('SELECT is_dirty FROM groups WHERE id = ? AND uid = ?', [groupId, uid]);

    if (groupStatusResult.length > 0 && groupStatusResult[0].is_dirty === 0) {
        const cachedResult = await d1Client.query('SELECT cache_data FROM group_cache WHERE group_id = ? AND uid = ?', [groupId, uid]);
        if (cachedResult.length > 0 && cachedResult[0].cache_data) {
            console.log(`[Cache HIT] for group ${groupId}. 直接回傳快取結果。`);
            return res.status(200).send({ success: true, data: JSON.parse(cachedResult[0].cache_data) });
        }
    }

    console.log(`[Cache MISS or DIRTY] for group ${groupId}. 執行完整計算...`);

    const involvedSymbolsResult = await d1Client.query(
        'SELECT DISTINCT t.symbol FROM transactions t JOIN group_transaction_inclusions g ON t.id = g.transaction_id WHERE g.uid = ? AND g.group_id = ?',
        [uid, groupId]
    );
    const involvedSymbols = involvedSymbolsResult.map(r => r.symbol);

    if (involvedSymbols.length === 0) {
        const emptyData = { holdings: [], summary: {}, history: {}, twrHistory: {}, netProfitHistory: {}, benchmarkHistory: {} };
        await d1Client.query('UPDATE groups SET is_dirty = 0 WHERE id = ? AND uid = ?', [groupId, uid]);
        return res.status(200).send({ success: true, data: emptyData });
    }

    const placeholders = involvedSymbols.map(() => '?').join(',');
    const allTxsForInvolvedSymbols = await d1Client.query(
        `SELECT * FROM transactions WHERE uid = ? AND symbol IN (${placeholders}) ORDER BY date ASC`,
        [uid, ...involvedSymbols]
    );

    const inclusionIdsResult = await d1Client.query(
        'SELECT transaction_id FROM group_transaction_inclusions WHERE uid = ? AND group_id = ?',
        [uid, groupId]
    );
    const inclusionTxIds = new Set(inclusionIdsResult.map(r => r.transaction_id));

    const txsForEngine = allTxsForInvolvedSymbols.filter(tx => inclusionTxIds.has(tx.id));

    const [allUserSplits, allUserDividends, controlsData] = await Promise.all([
        d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
        d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
        d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol'])
    ]);

    const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';

    const result = await runCalculationEngine(
        txsForEngine,
        allUserSplits,
        allUserDividends,
        benchmarkSymbol
    );

    const responseData = {
        holdings: Object.values(result.holdingsToUpdate),
        summary: result.summaryData,
        history: result.fullHistory,
        twrHistory: result.twrHistory,
        benchmarkHistory: result.benchmarkHistory,
        netProfitHistory: result.netProfitHistory,
    };

    const cacheOps = [
        {
            sql: 'INSERT OR REPLACE INTO group_cache (group_id, uid, cached_at, cache_data) VALUES (?, ?, ?, ?)',
            params: [groupId, uid, new Date().toISOString(), JSON.stringify(responseData)]
        },
        {
            sql: 'UPDATE groups SET is_dirty = 0 WHERE id = ? AND uid = ?',
            params: [groupId, uid]
        }
    ];
    await d1Client.batch(cacheOps);
    console.log(`[Cache WRITE] for group ${groupId}. 快取已更新。`);

    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 按需計算程序完成 ---`);
    return res.status(200).send({ success: true, data: responseData });
};