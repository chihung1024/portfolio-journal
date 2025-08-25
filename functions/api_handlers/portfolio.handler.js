// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v2.1 - Context-Aware Benchmark)
// =========================================================================================

const { d1Client } = require('../d1.client');

const ALL_GROUP_ID = 'all';

/**
 * 【舊 API - 保留】獲取使用者所有核心資料
 */
exports.getData = async (uid, res) => {
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
 * 超輕量級 API：只獲取儀表板摘要數據
 */
exports.getDashboardSummary = async (uid, res) => {
    const [summaryResult, stockNotes] = await Promise.all([
        d1Client.query('SELECT summary_data FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        d1Client.query('SELECT symbol, target_price, stop_loss_price FROM user_stock_notes WHERE uid = ?', [uid])
    ]);

    const summaryData = summaryResult[0] && summaryResult[0].summary_data ? JSON.parse(summaryResult[0].summary_data) : {};

    return res.status(200).send({
        success: true,
        data: {
            summary: summaryData,
            stockNotes
        }
    });
};

/**
 * API：只獲取持股列表 (Holdings)
 */
exports.getHoldings = async (uid, res) => {
    const holdings = await d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    return res.status(200).send({ success: true, data: { holdings } });
};


/**
 * 輕量級 API：只獲取儀表板和持股數據
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
 * API：只獲取交易和拆股紀錄
 */
exports.getTransactionsAndSplits = async (uid, res) => {
    const [transactions, splits] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid])
    ]);
    return res.status(200).send({ success: true, data: { transactions, splits } });
};

/**
 * API：只獲取所有圖表的歷史數據
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
 * 更新比較基準 (Benchmark)
 */
exports.updateBenchmark = async (uid, data, res) => {
    const dbOps = [];
    
    // 步驟 1: 更新 controls 表中的 benchmark 設定
    dbOps.push({
        sql: 'INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)',
        params: [uid, 'benchmarkSymbol', data.benchmarkSymbol.toUpperCase()]
    });

    // ========================= 【核心修改 - 開始】 =========================
    // 步驟 2: 不再觸發全局重算，而是將所有群組的快取標記為 "dirty"
    // 這是一個更優雅的快取失效策略，讓前端在需要時才觸發按需計算
    dbOps.push({
        sql: 'UPDATE groups SET is_dirty = 1 WHERE uid = ?',
        params: [uid]
    });
    
    // 步驟 3: 同時，也需要清除 portfolio_summary 中 'all' 群組的紀錄，
    // 以確保下次載入主儀表板時會強制重算。
    dbOps.push({
        sql: 'DELETE FROM portfolio_summary WHERE uid = ? AND group_id = ?',
        params: [uid, ALL_GROUP_ID]
    });
    
    await d1Client.batch(dbOps);
    // ========================= 【核心修改 - 結束】 =========================

    return res.status(200).send({ success: true, message: '基準已更新，相關快取已失效。' });
};
