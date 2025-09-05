// =========================================================================================
// == 平倉紀錄 API 處理模組 (closed_positions.handler.js) - v2.1 (Dividend-Aware)
// == 職責：處理獲取平倉紀錄的 API 請求，調用計算機並回傳結果。
// =========================================================================================

const { d1Client } = require('../d1.client');
const { z } = require("zod");
const dataProvider = require('../calculation/data.provider');
const { calculateFifoClosedPositions } = require('../calculation/closed_positions.calculator');

/**
 * 獲取並計算指定範圍內的平倉紀錄
 */
exports.getClosedPositions = async (uid, data, res) => {
    const schema = z.object({
        groupId: z.string().optional().nullable(),
    });

    const validatedData = schema.parse(data);
    const groupId = validatedData.groupId;

    try {
        let transactions;

        if (groupId && groupId !== 'all') {
            transactions = await d1Client.query(
                `SELECT t.* FROM transactions t 
                 JOIN group_transaction_inclusions g ON t.id = g.transaction_id
                 WHERE t.uid = ? AND g.group_id = ? 
                 ORDER BY t.symbol, t.date ASC`,
                [uid, groupId]
            );
        } else {
            transactions = await d1Client.query(
                'SELECT * FROM transactions WHERE uid = ? ORDER BY symbol, date ASC',
                [uid]
            );
        }

        if (!transactions || transactions.length === 0) {
            return res.status(200).send({ success: true, data: [] });
        }

        const market = await dataProvider.getMarketDataFromDb(transactions, 'SPY');

        const txsBySymbol = transactions.reduce((acc, tx) => {
            const symbol = tx.symbol.toUpperCase();
            if (!acc[symbol]) acc[symbol] = [];
            acc[symbol].push(tx);
            return acc;
        }, {});
        
        // 【核心修改】一次性獲取所有相關股票的股利數據
        const allSymbols = Object.keys(txsBySymbol);
        const placeholders = allSymbols.map(() => '?').join(',');
        const allDividends = await d1Client.query(
            `SELECT * FROM user_dividends WHERE uid = ? AND symbol IN (${placeholders})`,
            [uid, ...allSymbols]
        );
        const dividendsBySymbol = allDividends.reduce((acc, div) => {
            const symbol = div.symbol.toUpperCase();
            if (!acc[symbol]) acc[symbol] = [];
            acc[symbol].push(div);
            return acc;
        }, {});

        const closedPositionResults = [];
        for (const symbol in txsBySymbol) {
            // 【核心修改】傳入特定股票的交易和股利數據
            const symbolDividends = dividendsBySymbol[symbol] || [];
            const result = calculateFifoClosedPositions(symbol, txsBySymbol[symbol], symbolDividends, market);
            if (result) {
               closedPositionResults.push(result);
            }
        }
        
        closedPositionResults.sort((a, b) => b.totalRealizedPL - a.totalRealizedPL);

        return res.status(200).send({
            success: true,
            data: closedPositionResults,
        });

    } catch (error) {
        console.error(`[${uid}] 獲取平倉紀錄時發生錯誤:`, error);
        res.status(500).send({ success: false, message: `伺服器內部錯誤：${error.message}` });
    }
};
