// =========================================================================================
// == 檔案：functions/api_handlers/group.handler.js (v3.2 - Group Transactions Sync)
// == 職責：處理所有與群組管理和按需計算相關的 API Action
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { runCalculationEngine } = require('../calculation/engine');

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【新增】按需計算指定群組的核心邏輯函式
 * @param {string} uid - 使用者 ID
 * @param {string} groupId - 要計算的群組 ID
 * @returns {Promise<object|null>} - 計算成功則回傳包含 portfolio 數據的物件，否則回傳 null
 */
async function calculateGroupOnDemandCore(uid, groupId) {
    if (!groupId) {
        console.error(`[${uid}] calculateGroupOnDemandCore 缺少 groupId。`);
        return null;
    }
    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 核心計算程序開始 ---`);

    const groupStatusResult = await d1Client.query('SELECT is_dirty FROM groups WHERE id = ? AND uid = ?', [groupId, uid]);

    if (groupStatusResult.length > 0 && groupStatusResult[0].is_dirty === 0) {
        const cachedResult = await d1Client.query('SELECT cache_data FROM group_cache WHERE group_id = ? AND uid = ?', [groupId, uid]);
        if (cachedResult.length > 0 && cachedResult[0].cache_data) {
            console.log(`[Cache HIT] for group ${groupId}. 直接回傳快取結果。`);
            return JSON.parse(cachedResult[0].cache_data);
        }
    }

    console.log(`[Cache MISS or DIRTY] for group ${groupId}. 執行完整計算...`);

    const involvedSymbolsResult = await d1Client.query(
        'SELECT DISTINCT t.symbol FROM transactions t JOIN group_transaction_inclusions g ON t.id = g.transaction_id WHERE g.uid = ? AND g.group_id = ?',
        [uid, groupId]
    );
    const involvedSymbols = involvedSymbolsResult.map(r => r.symbol);

    if (involvedSymbols.length === 0) {
        // 【修改】即使群組為空，也要回傳一個結構完整的空物件
        const emptyData = { 
            holdings: [], 
            summary: {}, 
            history: {}, 
            twrHistory: {}, 
            netProfitHistory: {}, 
            benchmarkHistory: {},
            transactions: [] // 新增
        };
        await d1Client.query('UPDATE groups SET is_dirty = 0 WHERE id = ? AND uid = ?', [groupId, uid]);
        return emptyData;
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
        transactions: txsForEngine.sort((a, b) => new Date(b.date) - new Date(a.date)) // 【新增】將用於計算的交易紀錄回傳
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
    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 核心計算程序完成 ---`);
    return responseData;
}

// 將核心邏輯導出
exports.calculateGroupOnDemandCore = calculateGroupOnDemandCore;
// ========================= 【核心修改 - 結束】 =========================


/**
 * 獲取使用者建立的所有群組
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
 * 獲取單一特定群組的詳細資訊 (包含成員ID)
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
 * 獲取單一交易紀錄的群組歸屬情況
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


/**
 * 儲存一個群組（新增或編輯），採用顯性歸因模型
 */
exports.saveGroup = async (uid, data, res) => {
    const { id, name, description, transactionIds } = data;
    const groupId = id || uuidv4();

    if (id) {
        await d1Client.query('UPDATE groups SET name = ?, description = ?, is_dirty = 1 WHERE id = ? AND uid = ?', [name, description, id, uid]);
    } else {
        await d1Client.query('INSERT INTO groups (id, uid, name, description, is_dirty) VALUES (?, ?, ?, ?, 1)', [groupId, uid, name, description]);
    }

    const transactionOps = [];
    transactionOps.push({
        sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND group_id = ?',
        params: [uid, groupId]
    });
    if (transactionIds && transactionIds.length > 0) {
        transactionIds.forEach(txId => {
            transactionOps.push({
                sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)',
                params: [uid, groupId, txId]
            });
        });
    }

    await d1Client.batch(transactionOps);

    return res.status(200).send({ success: true, message: '群組已儲存。', groupId });
};

/**
 * 刪除一個群組
 */
exports.deleteGroup = async (uid, data, res) => {
    const { groupId } = data;
    
    const deleteOps = [
        {
            sql: 'DELETE FROM group_cache WHERE group_id = ? AND uid = ?',
            params: [groupId, uid]
        },
        {
            sql: 'DELETE FROM group_transaction_inclusions WHERE group_id = ? AND uid = ?',
            params: [groupId, uid]
        },
        {
            sql: 'DELETE FROM groups WHERE id = ? AND uid = ?',
            params: [groupId, uid]
        }
    ];
    await d1Client.batch(deleteOps);

    return res.status(200).send({ success: true, message: '群組已刪除。' });
};


/**
 * 【API 端點】按需計算指定群組的投資組合狀態
 */
exports.calculateGroupOnDemand = async (uid, data, res) => {
    const { groupId } = data;
    const resultData = await calculateGroupOnDemandCore(uid, groupId);

    if (resultData) {
        return res.status(200).send({ success: true, data: resultData });
    } else {
        return res.status(400).send({ success: false, message: '計算群組績效失敗。' });
    }
};

/**
 * 更新單一交易在所有群組中的成員資格
 */
exports.updateTransactionGroupMembership = async (uid, data, res) => {
    const { transactionId, groupIds } = data;

    const updateOps = [];
    updateOps.push({
        sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?',
        params: [uid, transactionId]
    });

    if (groupIds && groupIds.length > 0) {
        groupIds.forEach(groupId => {
            updateOps.push({
                sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)',
                params: [uid, groupId, transactionId]
            });
        });
    }

    await d1Client.batch(updateOps);

    if (groupIds && groupIds.length > 0) {
        const placeholders = groupIds.map(() => '?').join(',');
        await d1Client.query(
            `UPDATE groups SET is_dirty = 1 WHERE uid = ? AND id IN (${placeholders})`,
            [uid, ...groupIds]
        );
    }


    return res.status(200).send({ success: true, message: '交易的群組歸屬已更新。' });
};
