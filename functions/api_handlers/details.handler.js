// =========================================================================================
// == 個股詳情處理模組 (details.handler.js) - v2.0 (Group-Aware)
// == 職責：按需獲取單一股票的詳細資料 (交易、股利等)
// =========================================================================================

const { d1Client } = require('../d1.client');
const { z } = require("zod");

/**
 * 獲取指定股票的所有相關詳細資料
 */
exports.getSymbolDetails = async (uid, data, res) => {
    // ========================= 【核心修改 - 開始】 =========================
    // 1. 擴充驗證 schema，使其可以接收可選的 groupId
    const schema = z.object({
        symbol: z.string().min(1),
        groupId: z.string().optional().nullable(),
    });

    const validatedData = schema.parse(data);
    const symbol = validatedData.symbol.toUpperCase();
    const groupId = validatedData.groupId;

    let transactions;
    
    // 2. 根據是否提供了有效的 groupId，決定查詢方式
    if (groupId && groupId !== 'all') {
        // 如果在群組檢視中，則只查詢屬於該群組的交易
        transactions = await d1Client.query(
            `SELECT t.* FROM transactions t 
             JOIN group_transaction_inclusions g ON t.id = g.transaction_id
             WHERE t.uid = ? AND t.symbol = ? AND g.group_id = ? 
             ORDER BY t.date DESC`,
            [uid, symbol, groupId]
        );
    } else {
        // 如果在全局檢視中，則查詢所有交易
        transactions = await d1Client.query(
            'SELECT * FROM transactions WHERE uid = ? AND symbol = ? ORDER BY date DESC',
            [uid, symbol]
        );
    }
    // ========================= 【核心修改 - 結束】 =========================

    // 股利查詢邏輯不變，因為它不與群組掛鉤
    const confirmedDividends = await d1Client.query(
        'SELECT * FROM user_dividends WHERE uid = ? AND symbol = ? ORDER BY pay_date DESC',
        [uid, symbol]
    );

    return res.status(200).send({
        success: true,
        data: {
            transactions: transactions || [],
            confirmedDividends: confirmedDividends || []
        }
    });
};
