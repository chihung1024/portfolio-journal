// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v3.0 - Atomic & Resource-Oriented)
// == 職責：提供獨立、輕量級的 API 端點，用於獲取各種投資組合資源
// =========================================================================================

const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');

const ALL_GROUP_ID = 'all';

/**
 * 【核心邏輯】更新 Benchmark 的核心邏輯函式
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


// ========================= 【核心修改 - 開始】 =========================
// 【廢除】移除了 getData 和 getDashboardAndHoldings 兩個函式，
// 因為它們違反了 API 原子化和單一職責的原則。
// 前端現在將透過下面這些更細粒度的 API 來分別獲取所需數據。
// ========================= 【核心修改 - 結束】 =========================


/**
 * 【API 端點】超輕量級 API：只獲取儀表板摘要數據
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
 * 【API 端點】API：只獲取持股列表 (Holdings)
 */
exports.getHoldings = async (uid, res) => {
    const holdings = await d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
    return res.status(200).send({ success: true, data: { holdings } });
};

/**
 * 【API 端點】API：只獲取交易和拆股紀錄
 */
exports.getTransactionsAndSplits = async (uid, res) => {
    const [transactions, splits] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid])
    ]);
    return res.status(200).send({ success: true, data: { transactions, splits } });
};

/**
 * 【API 端點】API：只獲取所有圖表的歷史數據
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