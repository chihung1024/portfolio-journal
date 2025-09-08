// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v_benchmark_fix)
// == 職責：處理所有與投資組合數據相關的 API 請求，並回傳完整的數據酬載
// =========================================================================================

const { d1Client } = require('../d1.client');
const { z } = require('zod');

// 【新增】: 用於驗證更新比較基準請求的結構
const benchmarkSchema = z.object({
  symbol: z.string().min(1, '比較基準代碼為必填項'),
});

/**
 * 獲取使用者完整的投資組合數據
 * @param {object} c - Hono context object
 * @returns {Response} - 包含所有投資組合數據的 JSON 回應
 */
async function getData(c) {
    const uid = c.get('uid');
    const { groupId = 'all' } = c.req.query();
    const logPrefix = `[API|Portfolio|${uid}|G:${groupId}]`;

    try {
        console.log(`${logPrefix} 開始獲取投資組合數據...`);

        const [
            holdingsResult, 
            summaryResult, 
            transactionsResult, 
            splitsResult, 
            dividendsResult, 
            groupsResult, 
            closedPositionsResult,
            pendingDividendsResult
        ] = await Promise.all([
            d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, groupId]),
            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, groupId]),
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY ex_date DESC', [uid]),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid]),
            d1Client.query('SELECT * FROM `groups` WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM closed_positions WHERE uid = ? ORDER BY symbol ASC', [uid]),
            d1Client.query('SELECT * FROM user_pending_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid])
        ]);

        let finalSummary = {};
        if (summaryResult && summaryResult[0]) {
            const summary = summaryResult[0];
            finalSummary = {
                ...JSON.parse(summary.summary_data || '{}'),
                history: JSON.parse(summary.history || '{}'),
                twrHistory: JSON.parse(summary.twrHistory || '{}'),
                benchmarkHistory: JSON.parse(summary.benchmarkHistory || '{}'),
                netProfitHistory: JSON.parse(summary.netProfitHistory || '{}'),
                lastUpdated: summary.lastUpdated,
            };
        }
        
        console.log(`${logPrefix} 成功獲取所有數據，準備回傳。`);

        return c.json({
            holdings: holdingsResult || [],
            summary: finalSummary,
            transactions: transactionsResult || [],
            splits: splitsResult || [],
            dividends: dividendsResult || [],
            groups: groupsResult || [],
            closedPositions: closedPositionsResult || [],
            pendingDividends: pendingDividendsResult || []
        });

    } catch (e) {
        console.error(`${logPrefix} 獲取投資組合數據時發生錯誤:`, e);
        return c.json({ error: 'Failed to retrieve portfolio data' }, 500);
    }
}

/**
 * 【新增】: 更新使用者的比較基準代碼
 * @param {object} c - Hono context object
 * @returns {Response} - 操作成功或失敗的 JSON 回應
 */
async function updateBenchmark(c) {
    const uid = c.get('uid');
    const logPrefix = `[API|Benchmark|${uid}]`;
    try {
        const body = await c.req.json();
        const validation = benchmarkSchema.safeParse(body);
        if (!validation.success) {
            return c.json({ error: validation.error.flatten() }, 400);
        }
        const { symbol } = validation.data;
        console.log(`${logPrefix} 正在更新比較基準代碼為 ${symbol}...`);

        await d1Client.query(
            'INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)',
            [uid, 'benchmarkSymbol', symbol.toUpperCase()]
        );
        
        console.log(`${logPrefix} 比較基準代碼更新成功。`);
        // 注意：依循系統設計，重算應由客戶端在收到此成功回應後觸發
        return c.json({ success: true, message: '比較基準更新成功。' });
    } catch (e) {
        console.error(`${logPrefix} 更新比較基準時發生錯誤:`, e);
        return c.json({ error: '更新比較基準失敗' }, 500);
    }
}


module.exports = {
    getPortfolio: getData,
    // 【新增】: 將新的處理函式匯出，供路由器使用
    updateBenchmark: updateBenchmark,
};

