// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v5.0 - Architecture Refactor)
// == 描述：v5.0 架構重構，更新 API 以支援新的每日損益快照讀取機制。
// =========================================================================================

const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { z } = require("zod"); // 引入 zod 進行驗證

const ALL_GROUP_ID = 'all';

/**
 * 【新增】更新 Benchmark 的核心邏輯函式
 * @param {string} uid - 使用者 ID
 * @param {string} benchmarkSymbol - 新的 Benchmark 股票代碼
 */
async function updateBenchmarkCore(uid, benchmarkSymbol) {
    await d1Client.query(
        'INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)',
        [uid, 'benchmarkSymbol', benchmarkSymbol.toUpperCase()]
    );
    // 更新 Benchmark 會觸發對 'all' 群組的重算
    await performRecalculation(uid, null, false);
}

// 將核心邏輯導出
exports.updateBenchmarkCore = updateBenchmarkCore;


/**
 * 【舊 API - v5.0 修改】移除 netProfitHistory 的回傳
 */
exports.getData = async (uid, res) => {
    const [txs, splits, holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
    ]);

    const summaryRow = summaryResult[0] || {};
    const summaryData = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    // 【v5.0 修改】不再回傳 netProfitHistory

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

/**
 * 【新增】超輕量級 API：只獲取儀表板摘要數據
 */
exports.getDashboardSummary = async (uid, res) => {
    const [summaryResult] = await Promise.all([
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
    ]);

    const summaryData = summaryResult[0] && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
        }
    });
};

/**
 * 【新增】API：只獲取持股列表 (Holdings)
 */
exports.getHoldings = async (uid, res) => {
    const holdings = await d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    return res.status(200).send({ success: true, data: { holdings } });
};


/**
 * 【舊版 API - 修改】輕量級 API：只獲取儀表板和持股數據
 */
exports.getDashboardAndHoldings = async (uid, res) => {
    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
    ]);

    const summaryData = summaryResult[0] && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
            holdings,
        }
    });
};

/**
 * 【新增】API：只獲取交易和拆股紀錄
 */
exports.getTransactionsAndSplits = async (uid, res) => {
    const [transactions, splits] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid])
    ]);
    return res.status(200).send({ success: true, data: { transactions, splits } });
};

// ========================= 【v5.0 核心修改 - 開始】 =========================
/**
 * 【v5.0 重構】API：獲取圖表數據。現在能夠按需查詢每日損益快照。
 */
exports.getChartData = async (uid, data, res) => { // 新增 data 參數
    // 增加參數驗證
    const schema = z.object({
        groupId: z.string().optional().default('all'),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
    });
    const validatedData = schema.parse(data || {});
    const { groupId, startDate, endDate } = validatedData;

    // 1. 查詢 TWR 和資產歷史 (邏輯不變)
    const summaryResult = await d1Client.query('SELECT history, twrHistory, benchmarkHistory FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, groupId]);
    
    const summaryRow = summaryResult[0] || {};
    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    
    // 2. 查詢新的每日損益快照表
    let dailyPLSnapshots = [];
    // 預設查詢整個歷史
    let sql = 'SELECT date, pl_twd FROM daily_pl_snapshots WHERE uid = ? AND group_id = ? ORDER BY date ASC';
    const params = [uid, groupId];

    // 如果提供了日期範圍，則修改查詢語句
    if (startDate && endDate) {
        sql = 'SELECT date, pl_twd FROM daily_pl_snapshots WHERE uid = ? AND group_id = ? AND date >= ? AND date <= ? ORDER BY date ASC';
        params.push(startDate, endDate);
    }

    const plResults = await d1Client.query(sql, params);
    if (plResults) {
        // 將結果轉換為前端易於處理的物件格式 { 'YYYY-MM-DD': 123.45 }
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
            // 【v5.0 修改】回傳新的每日損益數據，而非舊的累積數據
            dailyPLSnapshots: dailyPLSnapshots
        }
    });
};
// ========================= 【v5.0 核心修改 - 結束】 =========================


/**
 * 【API 端點】更新比較基準 (Benchmark)
 */
exports.updateBenchmark = async (uid, data, res) => {
    await updateBenchmarkCore(uid, data.benchmarkSymbol);
    return res.status(200).send({ success: true, message: '基準已更新。' });
};
