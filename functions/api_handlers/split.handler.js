// =========================================================================================
// == 拆股 Action 處理模組 (split.handler.js) v2.0 - 整合群組快取失效邏輯
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { splitSchema } = require('../schemas');

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【新增輔助函式】根據股票代碼，將所有包含該股票的群組標記為 "dirty"。
 * @param {string} uid - 使用者 ID
 * @param {string} symbol - 發生變更的股票代碼
 */
async function markAssociatedGroupsAsDirtyBySymbol(uid, symbol) {
    // 1. 找出該股票的所有 transaction_id
    const txIdsResult = await d1Client.query(
        'SELECT id FROM transactions WHERE uid = ? AND symbol = ?',
        [uid, symbol]
    );
    const txIds = txIdsResult.map(r => r.id);

    if (txIds.length > 0) {
        // 2. 找出包含這些交易的所有 group_id
        const txPlaceholders = txIds.map(() => '?').join(',');
        const groupIdsResult = await d1Client.query(
            `SELECT DISTINCT group_id FROM group_transaction_inclusions WHERE uid = ? AND transaction_id IN (${txPlaceholders})`,
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
            console.log(`[Cache Invalidation] Marked groups as dirty due to split change for symbol ${symbol}: ${groupIds.join(', ')}`);
        }
    }
}
// ========================= 【核心修改 - 結束】 =========================


/**
 * 新增一筆拆股事件
 */
exports.addSplit = async (uid, data, res) => {
    const splitData = splitSchema.parse(data);
    const newSplitId = uuidv4();

    await d1Client.query(
        `INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`,
        [newSplitId, uid, splitData.date, splitData.symbol, splitData.ratio]
    );

    // 【新增】將與此股票相關的群組標記為 dirty
    await markAssociatedGroupsAsDirtyBySymbol(uid, splitData.symbol);

    await performRecalculation(uid, splitData.date, false);
    return res.status(200).send({ success: true, message: '分割事件已新增。', splitId: newSplitId });
};

/**
 * 刪除一筆拆股事件
 */
exports.deleteSplit = async (uid, data, res) => {
    const splitResult = await d1Client.query(
        'SELECT date, symbol FROM splits WHERE id = ? AND uid = ?',
        [data.splitId, uid]
    );
    
    if (splitResult.length === 0) {
        return res.status(404).send({ success: false, message: '找不到指定的拆股事件。'});
    }

    const splitDate = splitResult[0].date.split('T')[0];
    const symbol = splitResult[0].symbol;

    // 【新增】在刪除前，先將與此股票相關的群組標記為 dirty
    await markAssociatedGroupsAsDirtyBySymbol(uid, symbol);

    await d1Client.query(
        'DELETE FROM splits WHERE id = ? AND uid = ?',
        [data.splitId, uid]
    );

    await performRecalculation(uid, splitDate, false);
    return res.status(200).send({ success: true, message: '分割事件已刪除。' });
};
