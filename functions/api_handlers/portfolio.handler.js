// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v_refactored_closed_lots_fix)
// =========================================================================================

const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');

const ALL_GROUP_ID = 'all';

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【舊 API - 升級】獲取使用者所有核心資料 (預設為 'all' 群組)
 * - 新增：一併回傳 closed_lots 數據
 */
exports.getData = async (uid, res) => {
    const [txs, splits, holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        // 確保查詢包含 closed_lots 欄位
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
    ]);

    const summaryRow = summaryResult[0] || {};
    const summaryData = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};
    // 從資料庫讀取並解析 closed_lots
    const closedLots = summaryRow.closed_lots ? JSON.parse(summaryRow.closed_lots) : [];

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
            netProfitHistory,
            closedLots, // 將 closedLots 加入回傳數據中
        }
    });
};
// ========================= 【核心修改 - 結束】 =========================

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

/**
 * 【新增】API：只獲取所有圖表的歷史數據
 */
exports.getChartData = async (uid, res) => {
    const summaryResult = await d1Client.query('SELECT history, twrHistory, benchmarkHistory, netProfitHistory FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    
    const summaryRow = summaryResult[0] || {};
    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};

    return res.status(200).send({
        success: true,
        data: {
            portfolioHistory: history,
            twrHistory,
            benchmarkHistory,
            netProfitHistory
        }
    });
};


/**
 * 【API 端點】更新比較基準 (Benchmark)
 */
exports.updateBenchmark = async (uid, data, res) => {
    await updateBenchmarkCore(uid, data.benchmarkSymbol);
    return res.status(200).send({ success: true, message: '基準已更新。' });
};
