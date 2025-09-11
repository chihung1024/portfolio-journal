// =========================================================================================
// == 股利 Action 處理模組 (dividend.handler.js) v2.1 - 整合軟刪除與群組快取失效邏輯
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { userDividendSchema } = require('../schemas');

// ========================= 【輔助函式 - 無需修改】 =========================
/**
 * 【輔助函式】根據股票代碼(們)，將所有包含這些股票的群組標記為 "dirty"。
 * @param {string} uid - 使用者 ID
 * @param {string|string[]} symbols - 單一或多個發生變更的股票代碼
 */
async function markAssociatedGroupsAsDirtyBySymbol(uid, symbols) {
    const symbolList = Array.isArray(symbols) ? [...new Set(symbols)] : [symbols];
    if (symbolList.length === 0) return;

    // 1. 找出這些股票的所有 transaction_id
    const txPlaceholders = symbolList.map(() => '?').join(',');
    const txIdsResult = await d1Client.query(
        `SELECT id FROM transactions WHERE uid = ? AND symbol IN (${txPlaceholders})`,
        [uid, ...symbolList]
    );
    const txIds = txIdsResult.map(r => r.id);

    if (txIds.length > 0) {
        // 2. 找出包含這些交易的所有 group_id
        const groupTxPlaceholders = txIds.map(() => '?').join(',');
        const groupIdsResult = await d1Client.query(
            `SELECT DISTINCT group_id FROM group_transaction_inclusions WHERE uid = ? AND transaction_id IN (${groupTxPlaceholders})`,
            [uid, ...txIds]
        );
        const groupIds = groupIdsResult.map(r => r.group_id);

        if (groupIds.length > 0) {
            // 3. 將這些群組全部標記為 dirty
            const groupPlaceholders = groupIds.map(() => '?').join(',');
            await d1Client.query(
                `UPDATE groups SET is_dirty = 1 WHERE uid = ? AND id IN (${groupPlaceholders})`,
                [uid, ...groupIds]
            );
            console.log(`[Cache Invalidation] Marked groups as dirty due to dividend change for symbols ${symbolList.join(', ')}: ${groupIds.join(', ')}`);
        }
    }
}

/**
 * 獲取待確認及已確認的股利列表
 */
exports.getDividendsForManagement = async (uid, res) => {
    const [pendingDividends, confirmedDividends] = await Promise.all([
        d1Client.query('SELECT * FROM user_pending_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid]),
        // ========================= 【核心修改 #1 - 開始】 =========================
        // 說明：在這裡加上 "AND status = 'confirmed'" 條件，
        //       確保被軟刪除 (status='deleted') 的配息紀錄不會被讀取到前端。
        d1Client.query("SELECT * FROM user_dividends WHERE uid = ? AND status = 'confirmed' ORDER BY pay_date DESC", [uid])
        // ========================= 【核心修改 #1 - 結束】 =========================
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
    
    await d1Client.query(
        'DELETE FROM user_pending_dividends WHERE uid = ? AND symbol = ? AND ex_dividend_date = ?',
        [uid, parsedData.symbol, parsedData.ex_dividend_date]
    );

    const { id, ...divData } = parsedData;
    const dividendId = id || uuidv4();

    if (id) {
        await d1Client.query(
            `UPDATE user_dividends SET pay_date = ?, total_amount = ?, tax_rate = ?, notes = ? WHERE id = ? AND uid = ?`,
            [divData.pay_date, divData.total_amount, divData.tax_rate, divData.notes, id, uid]
        );
    } else {
        await d1Client.query(
            `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
            [dividendId, uid, divData.symbol, divData.ex_dividend_date, divData.pay_date, divData.amount_per_share, divData.quantity_at_ex_date, divData.total_amount, divData.tax_rate, divData.currency, divData.notes]
        );
    }

    await markAssociatedGroupsAsDirtyBySymbol(uid, parsedData.symbol);

    res.status(200).send({ success: true, message: '配息紀錄已儲存，後端將在背景更新數據。' });

    performRecalculation(uid, null, false).catch(err => {
        console.error(`[${uid}] UID 的背景儲存/編輯配息重算失敗:`, err);
    });

    return;
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
    const symbolsToInvalidate = new Set();
    const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;

    for (const pending of pendingDividends) {
        symbolsToInvalidate.add(pending.symbol);
        const payDateStr = pending.ex_dividend_date.split('T')[0];
        const taxRate = isTwStock(pending.symbol) ? 0.0 : 0.30;
        const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate);
        dbOps.push({
            sql: `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '批次確認')`,
            params: [
                uuidv4(), uid, pending.symbol, pending.ex_dividend_date,
                payDateStr, pending.amount_per_share, pending.quantity_at_ex_date,
                totalAmount, taxRate * 100, pending.currency
            ]
        });
    }

    if (dbOps.length > 0) {
        await d1Client.batch(dbOps);
        
        await markAssociatedGroupsAsDirtyBySymbol(uid, Array.from(symbolsToInvalidate));

        await performRecalculation(uid, null, false);
    }

    return res.status(200).send({ success: true, message: `成功批次確認 ${dbOps.length} 筆配息紀錄。` });
};

/**
 * 刪除一筆已確認的股利紀錄
 */
exports.deleteUserDividend = async (uid, data, res) => {
    const dividendResult = await d1Client.query(
        'SELECT symbol FROM user_dividends WHERE id = ? AND uid = ?',
        [data.dividendId, uid]
    );

    if (dividendResult.length > 0) {
        const symbol = dividendResult[0].symbol;
        await markAssociatedGroupsAsDirtyBySymbol(uid, symbol);
    }
    
    // ========================= 【核心修改 #2 - 開始】 =========================
    // 說明：將原本的物理刪除 (DELETE) 指令，
    //       改為更新狀態 (UPDATE ... SET status = 'deleted') 的軟刪除操作。
    //       增加 "AND status = 'confirmed'" 是為了確保只刪除目前為確認狀態的紀錄。
    await d1Client.query(
        "UPDATE user_dividends SET status = 'deleted' WHERE id = ? AND uid = ? AND status = 'confirmed'",
        [data.dividendId, uid]
    );
    // ========================= 【核心修改 #2 - 結束】 =========================
    
    res.status(200).send({ success: true, message: '配息紀錄已刪除，後端將在背景更新數據。' });

    performRecalculation(uid, null, false).catch(err => {
        console.error(`[${uid}] UID 的背景刪除配息重算失敗:`, err);
    });

    return;
};
