// =========================================================================================
// == 檔案：functions/api_handlers/group.handler.js (v2.0 - 顯性歸因模型)
// == 職責：處理所有與群組管理和按需計算相關的 API Action
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
// 【修改】不再需要 runCalculationEngine，因為 group handler 只負責數據準備
const { runCalculationEngine } = require('../calculation/engine');


/**
 * 獲取使用者建立的所有群組
 */
exports.getGroups = async (uid, res) => {
    // 【修改】查詢邏輯改變，不再關聯 stock_groups，而是統計 inclusions 表
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
        symbols: Array.from(g.symbols) // 將 Set 轉回陣列以便 JSON 序列化
    }));

    return res.status(200).send({
        success: true,
        data: finalGroups
    });
};

/**
 * 儲存一個群組（新增或編輯），採用顯性歸因模型
 */
exports.saveGroup = async (uid, data, res) => {
    const { id, name, description, transactionIds } = data; // 【修改】接收 transactionIds 而非 symbols
    const groupId = id || uuidv4();

    if (id) {
        // 更新群組基本資訊
        await d1Client.query('UPDATE groups SET name = ?, description = ? WHERE id = ? AND uid = ?', [name, description, id, uid]);
    } else {
        // 新增群組
        await d1Client.query('INSERT INTO groups (id, uid, name, description) VALUES (?, ?, ?, ?)', [groupId, uid, name, description]);
    }

    // 【核心修改】以 "先刪後增" 的方式，全面更新群組的成員
    const transactionOps = [];
    // 1. 先刪除該群組所有舊的成員關聯
    transactionOps.push({
        sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND group_id = ?',
        params: [uid, groupId]
    });
    // 2. 再插入所有新的成員關聯
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
    // 由於我們會在資料庫中設定 ON DELETE CASCADE，關聯表 group_transaction_inclusions 的紀錄會被自動刪除
    await d1Client.query('DELETE FROM groups WHERE id = ? AND uid = ?', [groupId, uid]);
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

    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 按需計算程序開始 ---`);

    // 【核心修改】計算邏輯極大簡化
    // 1. 直接查詢 inclusions 表獲取該群組應包含的所有交易 ID
    const inclusionTxsResult = await d1Client.query(
        'SELECT t.* FROM transactions t JOIN group_transaction_inclusions g ON t.id = g.transaction_id WHERE g.uid = ? AND g.group_id = ? ORDER BY t.date ASC',
        [uid, groupId]
    );

    if (inclusionTxsResult.length === 0) {
        // 如果群組是空的，直接回傳空結果
        return res.status(200).send({ success: true, data: { holdings: [], summary: {}, history: {}, twrHistory: {}, netProfitHistory: {}, benchmarkHistory: {} } });
    }
    
    const txsInGroup = inclusionTxsResult;

    // 2. 撈取計算所需的【全域】母數據
    const [allSplits, allUserDividends, controlsData] = await Promise.all([
        d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
        d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
        d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol'])
    ]);
    
    const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';

    // 3. 呼叫計算引擎，傳入【已精準篩選】的數據
    const result = await runCalculationEngine(
        txsInGroup, // 只傳入屬於該群組的交易
        allSplits, // 拆股和股利依然需要全域數據來計算
        allUserDividends,
        benchmarkSymbol
    );
    
    // 4. 將計算結果直接打包回傳
    const responseData = {
        holdings: Object.values(result.holdingsToUpdate),
        summary: result.summaryData,
        history: result.fullHistory,
        twrHistory: result.twrHistory,
        benchmarkHistory: result.benchmarkHistory,
        netProfitHistory: result.netProfitHistory,
    };

    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 按需計算程序完成 ---`);
    return res.status(200).send({ success: true, data: responseData });
};

/**
 * 【新增函式】更新單一交易在所有群組中的成員資格
 */
exports.updateTransactionGroupMembership = async (uid, data, res) => {
    const { transactionId, groupIds } = data; // groupIds 是一個包含該交易應屬群組ID的陣列

    const updateOps = [];
    // 1. 先刪除這筆交易在所有群組中的舊有歸屬
    updateOps.push({
        sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?',
        params: [uid, transactionId]
    });

    // 2. 再插入新的歸屬關係
    if (groupIds && groupIds.length > 0) {
        groupIds.forEach(groupId => {
            updateOps.push({
                sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)',
                params: [uid, groupId, transactionId]
            });
        });
    }

    await d1Client.batch(updateOps);

    return res.status(200).send({ success: true, message: '交易的群組歸屬已更新。' });
};
