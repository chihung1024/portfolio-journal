// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v2.2 - Self-Healing Bug Fix)
// =========================================================================================

const { d1Client } = require('../d1.client');
// 【新增】導入重算函式，以便在資料不存在時主動觸發
const { performRecalculation } = require('../performRecalculation');

const ALL_GROUP_ID = 'all';

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【新增輔助函式】確保 'all' 群組的計算結果存在，若不存在則主動觸發重算。
 * 這是一個「自我修復」機制，用以解決因快取失效（刪除紀錄）後資料讀取為空的問題。
 * @param {string} uid - 使用者 ID
 */
async function ensureAllGroupDataExists(uid) {
    // 檢查 portfolio_summary 表中是否存在 'all' 群組的紀錄
    const summaryCheck = await d1Client.query(
        'SELECT 1 FROM portfolio_summary WHERE uid = ? AND group_id = ? LIMIT 1',
        [uid, ALL_GROUP_ID]
    );

    // 如果不存在，代表快取已失效且尚未被重建
    if (summaryCheck.length === 0) {
        console.log(`[Self-Healing] UID ${uid} 的 'all' 群組摘要不存在，正在主動觸發重算...`);
        try {
            // 執行完整的重算程序，這將會重新產生 summary, holdings 等所有資料
            await performRecalculation(uid, null, false);
            console.log(`[Self-Healing] UID ${uid} 的 'all' 群組資料已成功重算並快取。`);
        } catch (error) {
            console.error(`[Self-Healing CRITICAL] UID ${uid} 在自我修復重算過程中失敗:`, error);
            // 即使重算失敗，也拋出錯誤，讓上層 API 知道發生了問題
            throw new Error('Failed to automatically recalculate portfolio data.');
        }
    }
}
// ========================= 【核心修改 - 結束】 =========================


/**
 * 【舊 API - 保留】獲取使用者所有核心資料
 */
exports.getData = async (uid, res) => {
    // 【修改】加入自我修復檢查
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
    // 【修改】加入自我修復檢查
    await ensureAllGroupDataExists(uid);

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
    // 【修改】加入自我修復檢查
    await ensureAllGroupDataExists(uid);

    const holdings = await d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    return res.status(200).send({ success: true, data: { holdings } });
};


/**
 * 輕量級 API：只獲取儀表板和持股數據
 */
exports.getDashboardAndHoldings = async (uid, res) => {
    // 【修改】加入自我修復檢查
    await ensureAllGroupDataExists(uid);

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
    // 交易和拆股紀錄是原始資料，不受重算影響，因此無需檢查
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
    // 【修改】加入自我修復檢查
    await ensureAllGroupDataExists(uid);

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

    return res.status(200).send({ success: true, message: '基準已更新，相關快取已失效。' });
};
