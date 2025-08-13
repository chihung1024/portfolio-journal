// =========================================================================================
// == 檔案：functions/api_handlers/transaction.handler.js
// == 職責：快速處理交易的資料庫寫入，並將完整的重算任務交給背景佇列。
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { transactionSchema } = require('../schemas');
// 【新增】引入背景任務觸發器
const { triggerBackgroundTask } = require('../task_queue.client');

/**
 * 新增一筆交易紀錄
 */
exports.addTransaction = async (uid, data, res) => {
    // 步驟 1: 驗證與寫入資料庫 (此為快速操作)
    const txData = transactionSchema.parse(data);
    const txId = uuidv4();

    await d1Client.query(
        `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
    );

    // 步驟 2: 觸發背景任務進行完整重算 (此為非同步操作，不會等待)
    await triggerBackgroundTask('performRecalculation', { uid: uid, modifiedTxDate: txData.date });

    // 步驟 3: 立即回傳成功訊息給前端
    // 前端的樂觀 UI (Optimistic UI) 會負責即時更新介面
    return res.status(200).send({
        success: true,
        message: '交易已接收，資產數據將在背景更新。',
        id: txId
    });
};

/**
 * 編輯一筆現有的交易紀錄
 */
exports.editTransaction = async (uid, data, res) => {
    // 步驟 1: 驗證與更新資料庫
    const txData = transactionSchema.parse(data.txData);
    const txId = data.txId;

    await d1Client.query(
        `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
        [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
    );
    
    // 步驟 2: 觸發背景任務
    await triggerBackgroundTask('performRecalculation', { uid: uid, modifiedTxDate: txData.date });
    
    // 步驟 3: 立即回傳
    return res.status(200).send({
        success: true,
        message: '交易已更新，資產數據將在背景更新。',
        id: txId
    });
};

/**
 * 刪除一筆交易紀錄
 */
exports.deleteTransaction = async (uid, data, res) => {
    // 步驟 1: 獲取交易日期以供後續使用，並刪除紀錄
    const txResult = await d1Client.query(
        'SELECT date FROM transactions WHERE id = ? AND uid = ?',
        [data.txId, uid]
    );
    const txDate = txResult.length > 0 ? txResult[0].date.split('T')[0] : null;

    await d1Client.query(
        'DELETE FROM transactions WHERE id = ? AND uid = ?',
        [data.txId, uid]
    );

    // 步驟 2: 觸發背景任務
    await triggerBackgroundTask('performRecalculation', { uid: uid, modifiedTxDate: txDate });

    // 步驟 3: 立即回傳
    return res.status(200).send({
        success: true,
        message: '交易已刪除，資產數據將在背景更新。'
    });
};
