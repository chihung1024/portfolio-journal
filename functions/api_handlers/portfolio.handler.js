// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (優化後)
// =========================================================================================

const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');

const ALL_GROUP_ID = 'all'; // 【核心修正】定義一個常量來代表 "全部股票"

/**
 * 【舊 API - 保留】獲取使用者所有核心資料 (預設為 'all' 群組)
 */
exports.getData = async (uid, res) => {
    // 【核心修正】在查詢 holdings 和 portfolio_summary 時，明確篩選 group_id = 'all'
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
 * 【新增】超輕量級 API：只獲取儀表板摘要數據
 */
exports.getDashboardSummary = async (uid, res) => {
    const [summaryResult, stockNotes] = await Promise.all([
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT symbol, target_price, stop_loss_price FROM user_stock_notes WHERE uid = ?', [uid]) // 只拿筆記中的關鍵價格欄位
    ]);

    const summaryData = summaryResult[0] && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
            stockNotes // 將筆記數據一併回傳，因為它很小且儀表板會用到
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
 * 【舊版 API - 修改】輕量級 API：只獲取儀表板和持股數據 (此函式現在可被拆分的 API 取代，但暫時保留以防萬一)
 */
exports.getDashboardAndHoldings = async (uid, res) => {
    const [holdings, summaryResult, stockNotes] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
    ]);

    const summaryData = summaryResult[0] && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
            holdings,
            stockNotes
        }
    });
};

/**
 * 【新增】API：只獲取交易和拆股紀錄 (用於分頁按需載入)
 */
exports.getTransactionsAndSplits = async (uid, res) => {
    const [transactions, splits] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid])
    ]);
    return res.status(200).send({ success: true, data: { transactions, splits } });
};

/**
 * 【新增】API：只獲取所有圖表的歷史數據 (用於背景載入)
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
            portfolioHistory: history, // <-- 為與前端 state 鍵名一致，此處改名
            twrHistory,
            benchmarkHistory,
            netProfitHistory
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
    // 更新 Benchmark 會觸發對 'all' 群組的重算
    await performRecalculation(uid, null, false);
    return res.status(200).send({ success: true, message: '基準已更新。' });
};
