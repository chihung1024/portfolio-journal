// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v5.1 - Hotfix)
// == 描述：v5.1 修復，增強 getChartData 函式對空數據庫結果的處理，防止 500 錯誤。
// =========================================================================================

const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { z } = require("zod");

const ALL_GROUP_ID = 'all';

async function updateBenchmarkCore(uid, benchmarkSymbol) {
    await d1Client.query(
        'INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)',
        [uid, 'benchmarkSymbol', benchmarkSymbol.toUpperCase()]
    );
    await performRecalculation(uid, null, false);
}

exports.updateBenchmarkCore = updateBenchmarkCore;

exports.getData = async (uid, res) => {
    const [txs, splits, holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
    ]);

    const summaryRow = summaryResult && summaryResult.length > 0 ? summaryResult[0] : {};
    const summaryData = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
            holdings,
            transactions: txs,
            splits,
            history,
            twrHistory,
            benchmarkHistory,
        }
    });
};

exports.getDashboardSummary = async (uid, res) => {
    const summaryResult = await d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    const summaryData = summaryResult && summaryResult.length > 0 && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
        }
    });
};

exports.getHoldings = async (uid, res) => {
    const holdings = await d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    return res.status(200).send({ success: true, data: { holdings: holdings || [] } });
};

exports.getDashboardAndHoldings = async (uid, res) => {
    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
    ]);
    const summaryData = summaryResult && summaryResult.length > 0 && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
            holdings: holdings || [],
        }
    });
};

exports.getTransactionsAndSplits = async (uid, res) => {
    const [transactions, splits] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid])
    ]);
    return res.status(200).send({ success: true, data: { transactions: transactions || [], splits: splits || [] } });
};

// ========================= 【v5.1 核心修改 - 開始】 =========================
/**
 * 【v5.1 修復】API：獲取圖表數據。增加對空結果的穩健處理。
 */
exports.getChartData = async (uid, data, res) => {
    const schema = z.object({
        groupId: z.string().optional().default('all'),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
    });
    const validatedData = schema.parse(data || {});
    const { groupId, startDate, endDate } = validatedData;

    // 1. 查詢 TWR 和資產歷史
    const summaryResult = await d1Client.query('SELECT history, twrHistory, benchmarkHistory FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, groupId]);
    
    // 【v5.1 修復】確保 summaryResult 是陣列且有內容才處理
    const summaryRow = Array.isArray(summaryResult) && summaryResult.length > 0 ? summaryResult[0] : {};
    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    
    // 2. 查詢新的每日損益快照表
    let dailyPLSnapshots = {};
    let sql = 'SELECT date, pl_twd FROM daily_pl_snapshots WHERE uid = ? AND group_id = ? ORDER BY date ASC';
    const params = [uid, groupId];

    if (startDate && endDate) {
        sql = 'SELECT date, pl_twd FROM daily_pl_snapshots WHERE uid = ? AND group_id = ? AND date >= ? AND date <= ? ORDER BY date ASC';
        params.push(startDate, endDate);
    }

    const plResults = await d1Client.query(sql, params);

    // 【v5.1 修復】確保 plResults 是陣列才處理
    if (Array.isArray(plResults)) {
        dailyPLSnapshots = plResults.reduce((acc, row) => {
            acc[row.date.split('T')[0]] = row.pl_twd;
            return acc;
        }, {});
    }

    return res.status(200).send({
        success: true,
        data: {
            portfolioHistory: history,
            twrHistory,
            benchmarkHistory,
            dailyPLSnapshots: dailyPLSnapshots
        }
    });
};
// ========================= 【v5.1 核心修改 - 結束】 =========================

exports.updateBenchmark = async (uid, data, res) => {
    await updateBenchmarkCore(uid, data.benchmarkSymbol);
    return res.status(200).send({ success: true, message: '基準已更新。' });
};
