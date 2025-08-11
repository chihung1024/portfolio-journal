// =========================================================================================
// == 交易 Action 處理模組 (transaction.handler.js)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../calculation.engine');
const { transactionSchema } = require('../schemas');

/**
 * 新增一筆交易紀錄
 */
exports.addTransaction = async (uid, data, res) => {
    const txData = transactionSchema.parse(data);
    const txId = uuidv4();

    await d1Client.query(
        `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
    );

    await performRecalculation(uid, txData.date, false);
    return res.status(200).send({ success: true, message: '操作成功。', id: txId });
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

    await performRecalculation(uid, txData.date, false);
    return res.status(200).send({ success: true, message: '操作成功。', id: txId });
};

/**
 * 刪除一筆交易紀錄
 */
exports.deleteTransaction = async (uid, data, res) => {
    const txResult = await d1Client.query(
        'SELECT date FROM transactions WHERE id = ? AND uid = ?',
        [data.txId, uid]
    );
    const txDate = txResult.length > 0 ? txResult[0].date.split('T')[0] : null;

    await d1Client.query(
        'DELETE FROM transactions WHERE id = ? AND uid = ?',
        [data.txId, uid]
    );

    await performRecalculation(uid, txDate, false);
    return res.status(200).send({ success: true, message: '交易已刪除。' });
};
