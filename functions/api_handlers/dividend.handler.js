// =========================================================================================
// == 股利 Action 處理模組 (dividend.handler.js)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { userDividendSchema } = require('../schemas');

/**
 * 獲取待確認及已確認的股利列表
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

/**
 * 儲存（新增或編輯）一筆使用者確認的股利
 */
exports.saveUserDividend = async (uid, data, res) => {
    const parsedData = userDividendSchema.parse(data);
    // 這一步是針對從「待確認」轉過來的操作，對於直接編輯「已確認」的紀錄沒有影響，可以保留
    await d1Client.query(
        'DELETE FROM user_pending_dividends WHERE uid = ? AND symbol = ? AND ex_dividend_date = ?',
        [uid, parsedData.symbol, parsedData.ex_dividend_date]
    );

    const { id, ...divData } = parsedData;
    const dividendId = id || uuidv4();

    if (id) {
        // 執行編輯（更新）資料庫
        await d1Client.query(
            `UPDATE user_dividends SET pay_date = ?, total_amount = ?, tax_rate = ?, notes = ? WHERE id = ? AND uid = ?`,
            [divData.pay_date, divData.total_amount, divData.tax_rate, divData.notes, id, uid]
        );
    } else {
        // 執行新增資料庫
        await d1Client.query(
            `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
            [dividendId, uid, divData.symbol, divData.ex_dividend_date, divData.pay_date, divData.amount_per_share, divData.quantity_at_ex_date, divData.total_amount, divData.tax_rate, divData.currency, divData.notes]
        );
    }

    // 立即回傳成功訊息
    res.status(200).send({ success: true, message: '配息紀錄已儲存，後端將在背景更新數據。' });

    // 在背景觸發重新計算，不等待其完成
    performRecalculation(uid, null, false).catch(err => {
        console.error(`[${uid}] UID 的背景儲存/編輯配息重算失敗:`, err);
    });

    return; // 明確結束函式
};

/**
 * 批次確認所有待處理股利
 */
exports.bulkConfirmAllDividends = async (uid, data, res) => {
    const pendingDividends = data.pendingDividends || [];
    if (pendingDividends.length === 0) {
        return res.status(200).send({ success: true, message: '沒有需要批次確認的配息。' });
    }

    const dbOps = [];
    const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;

    for (const pending of pendingDividends) {
        const payDateStr = pending.ex_dividend_date.split('T')[0];
        const taxRate = isTwStock(pending.symbol) ? 0.0 : 0.30;
        const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate);
        dbOps.push({
            sql: `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '批次確認')`,
            params: [
                uuidv4(),
                uid,
                pending.symbol,
                pending.ex_dividend_date,
                payDateStr, // 我們修改過的變數
                pending.amount_per_share,
                pending.quantity_at_ex_date,
                totalAmount,
                taxRate * 100,
                pending.currency
            ]
        });
    }

    if (dbOps.length > 0) {
        await d1Client.batch(dbOps);
        await performRecalculation(uid, null, false);
    }

    return res.status(200).send({ success: true, message: `成功批次確認 ${dbOps.length} 筆配息紀錄。` });
};

/**
 * 刪除一筆已確認的股利紀錄
 */
exports.deleteUserDividend = async (uid, data, res) => {
    await d1Client.query(
        'DELETE FROM user_dividends WHERE id = ? AND uid = ?',
        [data.dividendId, uid]
    );

    // 立即回傳成功訊息
    res.status(200).send({ success: true, message: '配息紀錄已刪除，後端將在背景更新數據。' });

    // 在背景觸發重新計算，不等待其完成
    performRecalculation(uid, null, false).catch(err => {
        console.error(`[${uid}] UID 的背景刪除配息重算失敗:`, err);
    });

    return; // 明確結束函式
};
