// =========================================================================================
// == 通用投資組合 Action 處理模組 (portfolio.handler.js)
// =========================================================================================

const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../calculation.engine');

/**
 * 獲取使用者所有核心資料
 */
exports.getData = async (uid, res) => {
    const [txs, splits, holdings, summaryResult, stockNotes] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM holdings WHERE uid = ?', [uid]),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ?', [uid]),
        d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
    ]);

    const summaryRow = summaryResult[0] || {};
    const summaryData = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
            holdings,
            transactions: txs,
            splits,
            stockNotes,
            history,
            twrHistory,
            benchmarkHistory,
            netProfitHistory,
        }
    });
};

/**
 * 更新比較基準 (Benchmark)
 */
exports.updateBenchmark = async (uid, data, res) => {
    await d1Client.query(
        'INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)',
        [uid, 'benchmarkSymbol', data.benchmarkSymbol.toUpperCase()]
    );
    await performRecalculation(uid, null, false);
    return res.status(200).send({ success: true, message: '基準已更新。' });
};
