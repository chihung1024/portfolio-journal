// =========================================================================================
// == 檔案：functions/api_handlers/group.handler.js (v3.0 - 快取優先架構)
// == 職責：處理所有與群組管理和按需計算相關的 API Action
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { runCalculationEngine } = require('../calculation/engine');


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
 * 【新增函式】獲取單一交易紀錄的群組歸屬情況
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
        // 在 `groups` 表中新增 is_dirty 欄位，型別為 BOOLEAN (INTEGER), 預設值為 1 (true)
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
    
    // 使用 batch 操作，原子性地刪除群組、其歸屬關係以及其快取
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
 * 按需計算指定群組的投資組合狀態（一次性，不儲存）
 */
exports.calculateGroupOnDemand = async (uid, data, res) => {
    const { groupId } = data;
    if (!groupId) {
        return res.status(400).send({ success: false, message: '缺少 groupId。' });
    }

    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 按需計算程序開始 (v3 - 快取優先) ---`);

    // 步驟 1: 檢查快取是否有效 (is_dirty = 0)
    // 注意: D1 的 BOOLEAN 是 INTEGER 0 或 1
    const groupStatusResult = await d1Client.query('SELECT is_dirty FROM groups WHERE id = ? AND uid = ?', [groupId, uid]);

    if (groupStatusResult.length > 0 && groupStatusResult[0].is_dirty === 0) {
        // 建立 group_cache 資料表: group_id (PK), uid, cached_at, cache_data (TEXT)
        const cachedResult = await d1Client.query('SELECT cache_data FROM group_cache WHERE group_id = ? AND uid = ?', [groupId, uid]);
        if (cachedResult.length > 0 && cachedResult[0].cache_data) {
            console.log(`[Cache HIT] for group ${groupId}. 直接回傳快取結果。`);
            return res.status(200).send({ success: true, data: JSON.parse(cachedResult[0].cache_data) });
        }
    }

    console.log(`[Cache MISS or DIRTY] for group ${groupId}. 執行完整計算...`);

    // ========================= 【核心修正 - 開始】 =========================
    // 步驟 2: 修正數據抓取範圍，確保計算的準確性

    // 2.1 找出該群組所有交易涉及的 "股票代碼" 集合
    const involvedSymbolsResult = await d1Client.query(
        'SELECT DISTINCT t.symbol FROM transactions t JOIN group_transaction_inclusions g ON t.id = g.transaction_id WHERE g.uid = ? AND g.group_id = ?',
        [uid, groupId]
    );
    const involvedSymbols = involvedSymbolsResult.map(r => r.symbol);

    if (involvedSymbols.length === 0) {
        // 如果群組內沒有任何股票，可以直接回傳空結果並清除髒標記
        const emptyData = { holdings: [], summary: {}, history: {}, twrHistory: {}, netProfitHistory: {}, benchmarkHistory: {} };
        await d1Client.query('UPDATE groups SET is_dirty = 0 WHERE id = ? AND uid = ?', [groupId, uid]);
        return res.status(200).send({ success: true, data: emptyData });
    }

    // 2.2 獲取這些股票的 "全部" 交易紀錄 (無論是否在群組內)
    const placeholders = involvedSymbols.map(() => '?').join(',');
    const allTxsForInvolvedSymbols = await d1Client.query(
        `SELECT * FROM transactions WHERE uid = ? AND symbol IN (${placeholders}) ORDER BY date ASC`,
        [uid, ...involvedSymbols]
    );

    // 2.3 找出該群組實際包含的 "交易ID" 集合，用於後續過濾
    const inclusionIdsResult = await d1Client.query(
        'SELECT transaction_id FROM group_transaction_inclusions WHERE uid = ? AND group_id = ?',
        [uid, groupId]
    );
    const inclusionTxIds = new Set(inclusionIdsResult.map(r => r.transaction_id));

    // 2.4 過濾出最終要傳入計算引擎的交易列表 (只計算群組內的交易)
    const txsForEngine = allTxsForInvolvedSymbols.filter(tx => inclusionTxIds.has(tx.id));

    // ========================= 【核心修正 - 結束】 =========================

    // 步驟 3: 呼叫計算引擎
    const [allUserSplits, allUserDividends, controlsData] = await Promise.all([
        d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
        d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
        d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol'])
    ]);

    const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';

    // 將修正後的、準確的交易數據傳入引擎
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

    // 步驟 4: 將計算結果寫入快取，並清除髒標記
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

    // 【新增】將所有相關的群組標記為 dirty
    if (groupIds && groupIds.length > 0) {
        const placeholders = groupIds.map(() => '?').join(',');
        await d1Client.query(
            `UPDATE groups SET is_dirty = 1 WHERE uid = ? AND id IN (${placeholders})`,
            [uid, ...groupIds]
        );
    }


    return res.status(200).send({ success: true, message: '交易的群組歸屬已更新。' });
};
