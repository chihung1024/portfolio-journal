// =========================================================================================
// == 個股詳情處理模組 (details.handler.js) - 【新增檔案】
// == 職責：按需獲取單一股票的詳細資料 (交易、股利等)
// =========================================================================================

const { d1Client } = require('../d1.client');
const { z } = require("zod");

/**
 * 獲取指定股票的所有相關詳細資料
 */
exports.getSymbolDetails = async (uid, data, res) => {
    // 驗證輸入的 symbol 是否為字串
    const schema = z.object({
        symbol: z.string().min(1),
    });
    const validatedData = schema.parse(data);
    const symbol = validatedData.symbol.toUpperCase();

    // 並行查詢資料庫，只撈取跟這個 symbol 相關的紀錄
    const [transactions, confirmedDividends] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? AND symbol = ? ORDER BY date DESC', [uid, symbol]),
        d1Client.query('SELECT * FROM user_dividends WHERE uid = ? AND symbol = ? ORDER BY pay_date DESC', [uid, symbol])
    ]);

    return res.status(200).send({
        success: true,
        data: {
            transactions: transactions || [],
            confirmedDividends: confirmedDividends || []
        }
    });
};
