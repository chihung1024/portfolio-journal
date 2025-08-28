// =========================================================================================
// == 平倉紀錄 API 處理模組 (closed_positions.handler.js) - 【新檔案】
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
    // 1. 驗證前端傳入的參數
    const schema = z.object({
        groupId: z.string().optional().nullable(),
    });

    const validatedData = schema.parse(data);
    const groupId = validatedData.groupId;

    try {
        let transactions;

        // 2. 根據是否提供了 groupId，從資料庫獲取對應的交易紀錄
        if (groupId && groupId !== 'all') {
            transactions = await d1Client.query(
                `SELECT t.* FROM transactions t 
                 JOIN group_transaction_inclusions g ON t.id = g.transaction_id
                 WHERE t.uid = ? AND g.group_id = ? 
                 ORDER BY t.symbol, t.date ASC`, // 按 symbol 和 date 排序，方便後續處理
                [uid, groupId]
            );
        } else {
            transactions = await d1Client.query(
                'SELECT * FROM transactions WHERE uid = ? ORDER BY symbol, date ASC',
                [uid]
            );
        }

        if (!transactions || transactions.length === 0) {
            return res.status(200).send({ success: true, data: [] }); // 沒有交易，直接回傳空陣列
        }

        // 3. 準備計算所需的市場數據 (匯率等)
        const market = await dataProvider.getMarketDataFromDb(transactions, 'SPY'); // benchmark 'SPY' is a placeholder, not strictly needed here but good practice

        // 4. 按股票代碼將所有交易分組
        const txsBySymbol = transactions.reduce((acc, tx) => {
            const symbol = tx.symbol.toUpperCase();
            if (!acc[symbol]) {
                acc[symbol] = [];
            }
            acc[symbol].push(tx);
            return acc;
        }, {});
        
        // 5. 為每一檔股票調用 FIFO 計算機
        const closedPositionResults = [];
        for (const symbol in txsBySymbol) {
            // 檢查該股票的淨持有量是否為零 (或趨近於零)
            const netQuantity = txsBySymbol[symbol].reduce((sum, tx) => {
                return sum + (tx.type === 'buy' ? tx.quantity : -tx.quantity);
            }, 0);

            // 只有當淨持有量為零時，才將其視為完全平倉的股票進行計算
            if (Math.abs(netQuantity) < 1e-9) {
                 const result = calculateFifoClosedPositions(symbol, txsBySymbol[symbol], market);
                 if (result) {
                    closedPositionResults.push(result);
                 }
            }
        }
        
        // 6. 按總損益降序排序結果
        closedPositionResults.sort((a, b) => b.totalRealizedPL - a.totalRealizedPL);

        // 7. 回傳最終結果
        return res.status(200).send({
            success: true,
            data: closedPositionResults,
        });

    } catch (error) {
        console.error(`[${uid}] 獲取平倉紀錄時發生錯誤:`, error);
        res.status(500).send({ success: false, message: `伺服器內部錯誤：${error.message}` });
    }
};
