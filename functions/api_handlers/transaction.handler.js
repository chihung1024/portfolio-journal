// =========================================================================================
// == 交易 Action 處理模組 (transaction.handler.js) v2.1 - 支援單次編輯
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { transactionSchema } = require('../schemas');

/**
 * 新增一筆交易紀錄 (維持兩步驟引導式)
 */
exports.addTransaction = async (uid, data, res) => {
    const { transactionData, groupInclusions, newGroups } = data;
    const txData = transactionSchema.parse(transactionData);
    const txId = uuidv4();

    const dbOps = [];

    if (newGroups && newGroups.length > 0) {
        newGroups.forEach(group => {
            const newGroupId = uuidv4();
            newGroupIdMap[group.tempId] = newGroupId;
            dbOps.push({
                sql: `INSERT INTO groups (id, uid, name, description) VALUES (?, ?, ?, ?)`,
                params: [newGroupId, uid, group.name, '']
            });
        });
    }

    dbOps.push({
        sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
    });

    if (groupInclusions && groupInclusions.length > 0) {
        groupInclusions.forEach(groupId => {
            const finalGroupId = newGroupIdMap[groupId] || groupId;
            dbOps.push({
                sql: `INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)`,
                params: [uid, finalGroupId, txId]
            });
        });
    }

    await d1Client.batch(dbOps);
    
    await performRecalculation(uid, txData.date, false);

    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all'])
    ]);
    
    const summaryRow = summaryResult[0] || {};
    const summary_data = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
    const portfolioHistory = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};

    return res.status(200).send({
        success: true,
        message: '操作成功。',
        id: txId,
        data: {
            holdings: holdings,
            summary: summary_data,
            history: portfolioHistory,
            twrHistory,
            netProfitHistory,
            benchmarkHistory
        }
    });
};

/**
 * 【核心修改】編輯一筆現有的交易紀錄 (合併群組編輯功能)
 */
exports.editTransaction = async (uid, data, res) => {
    // 從 payload 中解構出交易資料、群組歸屬和交易 ID
    const { txData: rawTxData, groupInclusions, txId } = data;
    const txData = transactionSchema.parse(rawTxData);

    if (!txId) {
        return res.status(400).send({ success: false, message: '缺少交易 ID (txId)。' });
    }

    const oldTxResult = await d1Client.query('SELECT symbol FROM transactions WHERE id = ? AND uid = ?', [txId, uid]);
    if (oldTxResult.length === 0) {
        return res.status(404).send({ success: false, message: '找不到指定的交易紀錄。' });
    }
    
    const dbOps = [];

    // 步驟 1: 更新交易紀錄本身
    dbOps.push({
        sql: `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
        params: [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
    });

    // 步驟 2: 刪除此交易所有舊的群組歸屬，為寫入新歸屬做準備
    dbOps.push({
        sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?',
        params: [uid, txId]
    });

    // 步驟 3: (可選) 如果有傳入新的群組歸屬，則插入新紀錄
    if (groupInclusions && Array.isArray(groupInclusions) && groupInclusions.length > 0) {
        groupInclusions.forEach(groupId => {
            // 這裡不處理 newGroups，因為編輯流程不應建立新群組
            if (typeof groupId === 'string' && !groupId.startsWith('temp_')) {
                 dbOps.push({
                    sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)',
                    params: [uid, groupId, txId]
                });
            }
        });
    }
    
    if (dbOps.length > 0) {
        await d1Client.batch(dbOps);
    }
    
    await performRecalculation(uid, txData.date, false);

    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all'])
    ]);
    
    const summaryRow = summaryResult[0] || {};
    const summary_data = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
    const portfolioHistory = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    
    return res.status(200).send({
        success: true,
        message: '交易已成功更新。',
        id: txId,
        data: {
            holdings: holdings,
            summary: summary_data,
            history: portfolioHistory,
            twrHistory,
            netProfitHistory,
            benchmarkHistory
        }
    });
};

/**
 * 刪除一筆交易紀錄
 */
exports.deleteTransaction = async (uid, data, res) => {
    const txResult = await d1Client.query('SELECT date FROM transactions WHERE id = ? AND uid = ?', [data.txId, uid]);
    const txDate = txResult.length > 0 ? txResult[0].date.split('T')[0] : null;

    const deleteOps = [
        { sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?', params: [uid, data.txId] },
        { sql: 'DELETE FROM transactions WHERE id = ? AND uid = ?', params: [data.txId, uid] }
    ];

    await d1Client.batch(deleteOps);
    await performRecalculation(uid, txDate, false);

    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all'])
    ]);
    
    const summaryRow = summaryResult[0] || {};
    const summary_data = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
    const portfolioHistory = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};

    return res.status(200).send({
        success: true,
        message: '交易已刪除。',
        data: {
            holdings: holdings,
            summary: summary_data,
            history: portfolioHistory,
            twrHistory,
            netProfitHistory,
            benchmarkHistory
        }
    });
};
