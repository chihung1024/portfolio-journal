// =========================================================================================
// == 交易 Action 處理模組 (transaction.handler.js) v2.0 - 數據完整性強化
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { transactionSchema } = require('../schemas');

/**
 * 新增一筆交易紀錄 (支援引導式群組歸因)
 */
exports.addTransaction = async (uid, data, res) => {
    // 【核心修正】將 'transactionData' 改為 'txData' 以與 API 慣例保持一致
    const { txData, groupInclusions, newGroups } = data;
    const parsedTxData = transactionSchema.parse(txData);
    const txId = uuidv4();

    const dbOps = [];

    // 步驟 1: (可選) 如果有新群組建立請求，先建立新群組
    const newGroupIdMap = {}; // 用於將臨時 ID 映射到真實的 UUID
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

    // 步驟 2: 插入新的交易紀錄
    dbOps.push({
        sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [txId, uid, parsedTxData.date, parsedTxData.symbol, parsedTxData.type, parsedTxData.quantity, parsedTxData.price, parsedTxData.currency, parsedTxData.totalCost, parsedTxData.exchangeRate]
    });

    // 步驟 3: (可選) 處理交易的群組歸屬
    if (groupInclusions && groupInclusions.length > 0) {
        groupInclusions.forEach(groupId => {
            // 如果是新建立的群組，使用其真實的 UUID
            const finalGroupId = newGroupIdMap[groupId] || groupId;
            dbOps.push({
                sql: `INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)`,
                params: [uid, finalGroupId, txId]
            });
        });
    }

    await d1Client.batch(dbOps);
    
    // 執行同步的全局重算
    await performRecalculation(uid, parsedTxData.date, false);

    // 【維持不變】重算後，查詢並回傳最新的完整 portfolio 狀態
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
 * 編輯一筆現有的交易紀錄
 */
exports.editTransaction = async (uid, data, res) => {
    const txData = transactionSchema.parse(data.txData);
    const txId = data.txId;

    // 【核心修改】數據完整性檢查
    // 步驟 1: 獲取編輯前的舊交易紀錄
    const oldTxResult = await d1Client.query('SELECT symbol FROM transactions WHERE id = ? AND uid = ?', [txId, uid]);
    if (oldTxResult.length === 0) {
        return res.status(404).send({ success: false, message: '找不到指定的交易紀錄。' });
    }
    const oldSymbol = oldTxResult[0].symbol.toUpperCase();
    const newSymbol = txData.symbol.toUpperCase();

    const dbOps = [];

    // 步驟 2: 如果股票代碼被修改，則自動清除其所有舊的群組歸屬
    if (oldSymbol !== newSymbol) {
        console.log(`[Data Integrity] Transaction ${txId} symbol changed from ${oldSymbol} to ${newSymbol}. Resetting group memberships.`);
        dbOps.push({
            sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?',
            params: [uid, txId]
        });
    }

    // 步驟 3: 更新交易紀錄本身
    dbOps.push({
        sql: `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
        params: [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
    });
    
    if (dbOps.length > 0) {
        await d1Client.batch(dbOps);
    }
    
    await performRecalculation(uid, txData.date, false);

    // 【維持不變】回傳最新的 portfolio 狀態
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
 * 刪除一筆交易紀錄
 */
exports.deleteTransaction = async (uid, data, res) => {
    // 【核心修改】數據完整性保障
    // 步驟 1: 獲取待刪除交易的日期，以用於後續的重算
    const txResult = await d1Client.query(
        'SELECT date FROM transactions WHERE id = ? AND uid = ?',
        [data.txId, uid]
    );
    const txDate = txResult.length > 0 ? txResult[0].date.split('T')[0] : null;

    // 步驟 2: 使用批次操作，確保交易本身和其群組關聯被原子性地刪除
    const deleteOps = [
        // a. 從群組歸屬表中刪除
        {
            sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?',
            params: [uid, data.txId]
        },
        // b. 從交易主表中刪除
        {
            sql: 'DELETE FROM transactions WHERE id = ? AND uid = ?',
            params: [data.txId, uid]
        }
    ];

    await d1Client.batch(deleteOps);
    
    await performRecalculation(uid, txDate, false);

    // 【維持不變】回傳最新的 portfolio 狀態
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
