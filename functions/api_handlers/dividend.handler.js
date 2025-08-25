// =========================================================================================
// == 股利 Action 處理模組 (dividend.handler.js) v3.0 - Staging-Ready
// =========================================================================================

const { d1Client } = require('../d1.client');
const { userDividendSchema } = require('../schemas');
const { stageChange } = require('./staging.handler'); // 導入暫存區處理器

/**
 * 獲取待確認及已確認的股利列表 (此函式保持不變，用於非暫存區的場景)
 */
exports.getDividendsForManagement = async (uid, res) => {
    const [pendingDividends, confirmedDividends] = await Promise.all([
        d1Client.query('SELECT * FROM user_pending_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid]),
        d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY pay_date DESC', [uid])
    ]);

    return res.status(200).send({
        success: true,
        data: {
            pendingDividends: pendingDividends || [],
            confirmedDividends: confirmedDividends || []
        }
    });
};

// ========================= 【核心修改 - 開始】 =========================

/**
 * 將「儲存股利」的請求轉發至暫存區
 */
exports.saveUserDividend = async (uid, data, res) => {
    const parsedData = userDividendSchema.parse(data);
    const op = parsedData.id ? 'UPDATE' : 'CREATE';

    // 直接呼叫 stageChange，將具體操作交給 staging.handler 處理
    return await stageChange(uid, { op, entity: 'dividend', payload: parsedData }, res);
};

/**
 * 將「批次確認股利」的請求轉發至暫存區
 */
exports.bulkConfirmAllDividends = async (uid, data, res) => {
    const pendingDividends = data.pendingDividends || [];
    if (pendingDividends.length === 0) {
        return res.status(200).send({ success: true, message: '沒有需要批次確認的配息。' });
    }

    const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
    const stageRequests = [];

    for (const pending of pendingDividends) {
        const payDateStr = pending.ex_dividend_date.split('T')[0];
        const taxRate = isTwStock(pending.symbol) ? 0.0 : 0.30;
        const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate);
        
        const dividendPayload = {
            symbol: pending.symbol,
            ex_dividend_date: pending.ex_dividend_date,
            pay_date: payDateStr,
            amount_per_share: pending.amount_per_share,
            quantity_at_ex_date: pending.quantity_at_ex_date,
            total_amount: totalAmount,
            tax_rate: taxRate * 100,
            currency: pending.currency,
            notes: '批次確認'
        };
        
        // 為每一筆都建立一個暫存請求
        stageRequests.push(
            stageChange(uid, { op: 'CREATE', entity: 'dividend', payload: dividendPayload }, res, true)
        );
    }

    // 注意：此處的 res 已經在 stageChange 內部處理，但為了流程完整性，我們等待所有操作完成
    await Promise.all(stageRequests);
    
    // 因為 stageChange 會各自發送 response，這裡回傳一個通用的成功訊息
    // 前端應主要依賴 stage_change 的回傳，而非此處
    return res.status(200).send({ success: true, message: `已為 ${stageRequests.length} 筆配息建立暫存。` });
};

/**
 * 將「刪除股利」的請求轉發至暫存區
 */
exports.deleteUserDividend = async (uid, data, res) => {
    // 只需傳遞 ID 即可
    return await stageChange(uid, { op: 'DELETE', entity: 'dividend', payload: { id: data.dividendId } }, res);
};

// ========================= 【核心修改 - 結束】 =========================