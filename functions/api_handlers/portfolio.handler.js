// =========================================================================================
// == 檔案：functions/api_handlers/portfolio.handler.js (v_e2e_fix_1)
// == 職責：處理所有與投資組合數據相關的 API 請求，並回傳完整的數據酬載
// =========================================================================================

const { d1Client } = require('../d1.client');
const { z } = require('zod');

const groupSchema = z.object({
  name: z.string().min(1, '名稱為必填項'),
  symbols: z.array(z.string()).optional(),
});

const updateSymbolsInGroupSchema = z.object({
  symbols: z.array(z.string()),
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

        // 【核心修正】: 在 Promise.all 中新增對 user_pending_dividends 資料表的查詢
        const [
            holdingsResult, 
            summaryResult, 
            transactionsResult, 
            splitsResult, 
            dividendsResult, 
            groupsResult, 
            closedPositionsResult,
            pendingDividendsResult // <-- 新增的查詢結果
        ] = await Promise.all([
            d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, groupId]),
            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, groupId]),
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY ex_date DESC', [uid]),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid]),
            d1Client.query('SELECT * FROM `groups` WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM closed_positions WHERE uid = ? ORDER BY symbol ASC', [uid]),
            // <-- 新增的資料庫查詢，用於獲取待確認配息
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

        // 【核心修正】: 將 pendingDividendsResult 加入 API 的回傳酬載中
        return c.json({
            holdings: holdingsResult || [],
            summary: finalSummary,
            transactions: transactionsResult || [],
            splits: splitsResult || [],
            dividends: dividendsResult || [],
            groups: groupsResult || [],
            closedPositions: closedPositionsResult || [],
            pendingDividends: pendingDividendsResult || [] // <-- 將待確認配息數據回傳給前端
        });

    } catch (e) {
        console.error(`${logPrefix} 獲取投資組合數據時發生錯誤:`, e);
        return c.json({ error: 'Failed to retrieve portfolio data' }, 500);
    }
}

module.exports = {
    getPortfolio: getData,
};
