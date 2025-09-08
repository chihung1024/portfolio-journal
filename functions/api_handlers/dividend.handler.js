// =========================================================================================
// == 檔案：functions/api_handlers/dividend.handler.js (v_critical_hotfix)
// == 職責：處理使用者已確認股息的 CRUD 操作，並修正了先前版本中存在的破壞性副作用
// =========================================================================================

const { d1Client } = require('../d1.client');
const { z } = require('zod');
const { performRecalculation } = require('../performRecalculation');

const dividendSchema = z.object({
    symbol: z.string().min(1),
    ex_dividend_date: z.string().min(1),
    payment_date: z.string().min(1),
    total_amount: z.number().positive(),
    currency: z.string().min(1),
});

async function addDividend(c) {
    const uid = c.get('uid');
    const logPrefix = `[API|Dividend|${uid}]`;
    try {
        const body = await c.req.json();
        const validation = dividendSchema.safeParse(body);
        if (!validation.success) {
            return c.json({ error: validation.error.flatten() }, 400);
        }
        const { symbol, ex_dividend_date, payment_date, total_amount, currency } = validation.data;
        
        await d1Client.query(
            'INSERT INTO user_dividends (uid, symbol, ex_dividend_date, payment_date, total_amount, currency) VALUES (?, ?, ?, ?, ?, ?)',
            [uid, symbol.toUpperCase(), ex_dividend_date, payment_date, total_amount, currency]
        );
        
        c.executionCtx.waitUntil(performRecalculation(uid, ex_dividend_date));
        return c.json({ success: true }, 201);
    } catch (e) {
        console.error(`${logPrefix} 新增股息時發生錯誤:`, e);
        return c.json({ error: '新增股息失敗' }, 500);
    }
}

async function updateDividend(c) {
    const uid = c.get('uid');
    const { id } = c.req.param();
    const logPrefix = `[API|Dividend|${uid}|ID:${id}]`;
    try {
        const body = await c.req.json();
        const validation = dividendSchema.safeParse(body);
        if (!validation.success) {
            return c.json({ error: validation.error.flatten() }, 400);
        }
        const { symbol, ex_dividend_date, payment_date, total_amount, currency } = validation.data;
        
        await d1Client.query(
            'UPDATE user_dividends SET symbol = ?, ex_dividend_date = ?, payment_date = ?, total_amount = ?, currency = ? WHERE id = ? AND uid = ?',
            [symbol.toUpperCase(), ex_dividend_date, payment_date, total_amount, currency, id, uid]
        );

        c.executionCtx.waitUntil(performRecalculation(uid, ex_dividend_date));
        return c.json({ success: true });
    } catch (e) {
        console.error(`${logPrefix} 更新股息時發生錯誤:`, e);
        return c.json({ error: '更新股息失敗' }, 500);
    }
}

async function deleteDividend(c) {
    const uid = c.get('uid');
    const { id } = c.req.param();
    const logPrefix = `[API|Dividend|${uid}|ID:${id}]`;
    try {
        const dividendToDelete = await d1Client.query('SELECT ex_dividend_date FROM user_dividends WHERE id = ? AND uid = ?', [id, uid]);
        const triggerDate = dividendToDelete?.[0]?.ex_dividend_date;

        await d1Client.query('DELETE FROM user_dividends WHERE id = ? AND uid = ?', [id, uid]);
        
        // ========================= 【根本原因修正】 =========================
        // 此處先前版本中存在一行錯誤的程式碼，它會從全域的 `dividend_history`
        // 資料表中刪除對應的紀錄，造成了資料汙染與功能失效。
        //
        // await d1Client.query('DELETE FROM dividend_history WHERE symbol = ? AND date = ?', [symbol, dateStr]);
        //
        // 該行程式碼已被永久移除，以確保使用者的個人操作不會影響系統級的基礎數據。
        // 現在，刪除操作僅會影響 `user_dividends` 資料表，符合預期設計。
        // =================================================================

        if (triggerDate) {
            c.executionCtx.waitUntil(performRecalculation(uid, triggerDate));
        }

        return c.json({ success: true });
    } catch (e) {
        console.error(`${logPrefix} 刪除股息時發生錯誤:`, e);
        return c.json({ error: '刪除股息失敗' }, 500);
    }
}

module.exports = {
    addDividend,
    updateDividend,
    deleteDividend
};
