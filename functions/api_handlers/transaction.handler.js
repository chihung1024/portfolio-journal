// =========================================================================================
// == 檔案：functions/api_handlers/transaction.handler.js (非同步架構版)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { transactionSchema } = require('../schemas');
const { enqueueTask } = require('../task_queue.client'); // 引入我們的新函式

/**
 * 新增一筆交易紀錄
 */
exports.addTransaction = async (uid, data, res) => {
    // 步驟 1: 驗證與寫入資料庫 (快速操作)
    const txData = transactionSchema.parse(data);
    const txId = uuidv4();

    await d1Client.query(
        `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
    );

    // 步驟 2: 將耗時的後續處理，作為一個任務推送到背景佇列
    const taskPayload = { uid, symbol: txData.symbol, txDate: txData.date };
    await enqueueTask('postTransactionWorker', taskPayload);

    // 步驟 3: 立即回傳成功訊息給前端
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
    const txData = transactionSchema.parse(data.txData);
    const txId = data.txId;

    await d1Client.query(
        `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
        [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
    );
    
    const taskPayload = { uid, symbol: txData.symbol, txDate: txData.date };
    await enqueueTask('postTransactionWorker', taskPayload);
    
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
    const txResult = await d1Client.query(
        'SELECT date, symbol FROM transactions WHERE id = ? AND uid = ?',
        [data.txId, uid]
    );
    
    if (txResult.length === 0) {
        return res.status(404).send({ success: false, message: '找不到該筆交易紀錄。' });
    }

    await d1Client.query(
        'DELETE FROM transactions WHERE id = ? AND uid = ?',
        [data.txId, uid]
    );

    const txDate = txResult[0].date.split('T')[0];
    const symbol = txResult[0].symbol;
    
    const taskPayload = { uid, symbol, txDate };
    await enqueueTask('postTransactionWorker', taskPayload);

    return res.status(200).send({
        success: true,
        message: '交易已刪除，資產數據將在背景更新。'
    });
};
