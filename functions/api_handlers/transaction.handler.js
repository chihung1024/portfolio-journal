// =========================================================================================
// == 交易 Action 處理模組 (transaction.handler.js)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
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

    // 【新增】重算後，立刻查詢最新結果
    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ?', [uid]),
        // 取得完整的 summary 紀錄
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ?', [uid])
    ]);
    
    // 解析所有需要的數據
    const summaryRow = summaryResult[0] || {};
    const summary_data = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
    const portfolioHistory = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};

    // 在回應中包含所有圖表數據
    return res.status(200).send({
        success: true,
        message: '操作成功。',
        id: txId,
        data: {
            holdings: holdings,
            summary: summary_data,
            portfolioHistory,
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

    await d1Client.query(
        `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
        [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
    );

    await performRecalculation(uid, txData.date, false);

    // 【新增】重算後，立刻查詢最新結果
    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ?', [uid]),
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ?', [uid])
    ]);
    const summary_data = summaryResult[0] ? JSON.parse(summaryResult[0].summary_data) : {};
    
    // 【修改】在回應中包含新數據
    return res.status(200).send({
        success: true,
        message: '操作成功。',
        id: txId,
        data: {
            holdings: holdings,
            summary: summary_data
        }
    });
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

    // 【新增】重算後，立刻查詢最新結果
    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ?', [uid]),
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ?', [uid])
    ]);
    const summary_data = summaryResult[0] ? JSON.parse(summaryResult[0].summary_data) : {};

    // 【修改】在回應中包含新數據
    return res.status(200).send({
        success: true,
        message: '交易已刪除。',
        data: {
            holdings: holdings,
            summary: summary_data
        }
    });
};
