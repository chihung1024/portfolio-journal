// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v3.0 - Refactored for Staging)
// == 職責：提供所有與投資組合相關的唯讀 API。CUD 操作已移至 staging.handler。
// =========================================================================================

const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');

const ALL_GROUP_ID = 'all';

/**
 * 【輔助函式】確保 'all' 群組的計算結果存在，若不存在則主動觸發重算。
 */
async function ensureAllGroupDataExists(uid) {
    const summaryCheck = await d1Client.query(
        'SELECT 1 FROM portfolio_summary WHERE uid = ? AND group_id = ? LIMIT 1',
        [uid, ALL_GROUP_ID]
    );

    if (summaryCheck.length === 0) {
        console.log(`[Self-Healing] UID ${uid} 的 'all' 群組摘要不存在，正在主動觸發重算...`);
        try {
            await performRecalculation(uid, null, false);
            console.log(`[Self-Healing] UID ${uid} 的 'all' 群組資料已成功重算並快取。`);
        } catch (error) {
            console.error(`[Self-Healing CRITICAL] UID ${uid} 在自我修復重算過程中失敗:`, error);
            throw new Error('Failed to automatically recalculate portfolio data.');
        }
    }
}


/**
 * 【保留】獲取使用者所有核心資料
 */
exports.getData = async (uid, res) => {
    await ensureAllGroupDataExists(uid);

    const [txs, splits, holdings, summaryResult, stockNotes] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
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
            summary: summaryData, holdings, transactions: txs, splits, stockNotes,
            history, twrHistory, benchmarkHistory, netProfitHistory,
        }
    });
};

/**
 * 【保留】只獲取儀表板摘要數據
 */
exports.getDashboardSummary = async (uid, res) => {
    await ensureAllGroupDataExists(uid);
    const [summaryResult, stockNotes] = await Promise.all([
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT symbol, target_price, stop_loss_price FROM user_stock_notes WHERE uid = ?', [uid])
    ]);
    const summaryData = summaryResult[0] && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};
    return res.status(200).send({ success: true, data: { summary: summaryData, stockNotes }});
};

/**
 * 【保留】只獲取持股列表
 */
exports.getHoldings = async (uid, res) => {
    await ensureAllGroupDataExists(uid);
    const holdings = await d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    return res.status(200).send({ success: true, data: { holdings } });
};

/**
 * 【保留】只獲取儀表板和持股數據
 */
exports.getDashboardAndHoldings = async (uid, res) => {
    await ensureAllGroupDataExists(uid);
    const [holdings, summaryResult, stockNotes] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
    ]);
    const summaryData = summaryResult[0] && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};
    return res.status(200).send({ success: true, data: { summary: summaryData, holdings, stockNotes }});
};

/**
 * 【保留】只獲取交易和拆股紀錄
 */
exports.getTransactionsAndSplits = async (uid, res) => {
    const [transactions, splits] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid])
    ]);
    return res.status(200).send({ success: true, data: { transactions, splits } });
};

/**
 * 【保留】只獲取所有圖表的歷史數據
 */
exports.getChartData = async (uid, res) => {
    await ensureAllGroupDataExists(uid);
    const summaryResult = await d1Client.query('SELECT history, twrHistory, benchmarkHistory, netProfitHistory FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    const summaryRow = summaryResult[0] || {};
    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};
    return res.status(200).send({ success: true, data: { portfolioHistory: history, twrHistory, benchmarkHistory, netProfitHistory }});
};


// ========================= 【核心修改 - 開始】 =========================
// 【移除】updateBenchmark 函式
// 理由：更新 Benchmark 的操作現在由前端發起 'stage_change' API，
//       並由 staging.handler.js 的 'commitAllChanges' 統一處理。
/*
exports.updateBenchmark = async (uid, data, res) => {
    const dbOps = [];
    dbOps.push({
        sql: 'INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)',
        params: [uid, 'benchmarkSymbol', data.benchmarkSymbol.toUpperCase()]
    });
    dbOps.push({
        sql: 'UPDATE groups SET is_dirty = 1 WHERE uid = ?',
        params: [uid]
    });
    dbOps.push({
        sql: 'DELETE FROM portfolio_summary WHERE uid = ? AND group_id = ?',
        params: [uid, ALL_GROUP_ID]
    });
    await d1Client.batch(dbOps);
    return res.status(200).send({ success: true, message: '基準已更新，相關快取已失效。' });
};
*/
// ========================= 【核心修改 - 結束】 =========================