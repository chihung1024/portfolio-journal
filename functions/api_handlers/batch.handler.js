// =========================================================================================
// == 批次操作 Action 處理模組 (batch.handler.js) v3.1 - 修正配息刪除邏輯的唯一性衝突
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { transactionSchema, splitSchema, userDividendSchema, groupSchema } = require('../schemas');

/**
 * 【輔助函式】根據股票代碼(們)，將所有包含這些股票的群組標記為 "dirty"。
 */
async function markAssociatedGroupsAsDirtyBySymbol(uid, symbols, d1) {
    const symbolList = Array.isArray(symbols) ? [...new Set(symbols)] : [symbols];
    if (symbolList.length === 0) return;

    const txPlaceholders = symbolList.map(() => '?').join(',');
    const txIdsResult = await d1.query(
        `SELECT id FROM transactions WHERE uid = ? AND symbol IN (${txPlaceholders})`,
        [uid, ...symbolList]
    );
    const txIds = txIdsResult.map(r => r.id);

    if (txIds.length > 0) {
        const groupTxPlaceholders = txIds.map(() => '?').join(',');
        const groupIdsResult = await d1.query(
            `SELECT DISTINCT group_id FROM group_transaction_inclusions WHERE uid = ? AND transaction_id IN (${groupTxPlaceholders})`,
            [uid, ...txIds]
        );
        const groupIds = groupIdsResult.map(r => r.group_id);

        if (groupIds.length > 0) {
            const groupPlaceholders = groupIds.map(() => '?').join(',');
            await d1.query(
                `UPDATE groups SET is_dirty = 1 WHERE uid = ? AND id IN (${groupPlaceholders})`,
                [uid, ...groupIds]
            );
            console.log(`[Cache Invalidation] Marked groups as dirty due to batch change for symbols ${symbolList.join(', ')}: ${groupIds.join(', ')}`);
        }
    }
}

/**
 * 處理前端提交的批次操作
 */
exports.submitBatch = async (uid, data, res) => {
    const { actions } = data;
    if (!actions || !Array.isArray(actions) || actions.length === 0) {
        return res.status(400).send({ success: false, message: '無效的操作請求。' });
    }

    const dbOps = [];
    const symbolsToInvalidate = new Set();
    const groupsToRecalculate = new Set();

    for (const action of actions) {
        const { entity, type, payload } = action;

        switch (entity) {
            case 'transaction':
                const txData = transactionSchema.parse(payload);
                symbolsToInvalidate.add(txData.symbol);
                if (type === 'CREATE') {
                    dbOps.push({
                        sql: 'INSERT INTO transactions (id, uid, symbol, transaction_type, quantity, price, transaction_date, currency, fee, tax, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        params: [txData.id, uid, txData.symbol, txData.transaction_type, txData.quantity, txData.price, txData.transaction_date, txData.currency, txData.fee, txData.tax, txData.notes]
                    });
                } else if (type === 'UPDATE') {
                    dbOps.push({
                        sql: 'UPDATE transactions SET symbol = ?, transaction_type = ?, quantity = ?, price = ?, transaction_date = ?, currency = ?, fee = ?, tax = ?, notes = ? WHERE id = ? AND uid = ?',
                        params: [txData.symbol, txData.transaction_type, txData.quantity, txData.price, txData.transaction_date, txData.currency, txData.fee, txData.tax, txData.notes, txData.id, uid]
                    });
                } else if (type === 'DELETE') {
                    dbOps.push({ sql: 'DELETE FROM transactions WHERE id = ? AND uid = ?', params: [txData.id, uid] });
                    dbOps.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE transaction_id = ? AND uid = ?', params: [txData.id, uid] });
                }
                break;

            case 'split':
                const splitData = splitSchema.parse(payload);
                symbolsToInvalidate.add(splitData.symbol);
                if (type === 'CREATE') {
                    dbOps.push({ sql: 'INSERT INTO user_splits (id, uid, symbol, split_date, from_factor, to_factor) VALUES (?, ?, ?, ?, ?, ?)', params: [splitData.id, uid, splitData.symbol, splitData.split_date, splitData.from_factor, splitData.to_factor] });
                } else if (type === 'DELETE') {
                    dbOps.push({ sql: 'DELETE FROM user_splits WHERE id = ? AND uid = ?', params: [splitData.id, uid] });
                }
                break;

            case 'dividend':
                const divData = userDividendSchema.parse(payload);
                symbolsToInvalidate.add(divData.symbol);
                if (type === 'CREATE') {
                    dbOps.push({
                        sql: `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
                        params: [divData.id, uid, divData.symbol, divData.ex_dividend_date, divData.pay_date, divData.amount_per_share, divData.quantity_at_ex_date, divData.total_amount, divData.tax_rate, divData.currency, divData.notes]
                    });
                    dbOps.push({ sql: 'DELETE FROM user_pending_dividends WHERE uid = ? AND symbol = ? AND ex_dividend_date = ?', params: [uid, divData.symbol, divData.ex_dividend_date] });
                } else if (type === 'UPDATE') {
                    dbOps.push({
                        sql: 'UPDATE user_dividends SET pay_date = ?, total_amount = ?, tax_rate = ?, notes = ? WHERE id = ? AND uid = ?',
                        params: [divData.pay_date, divData.total_amount, divData.tax_rate, divData.notes, divData.id, uid]
                    });
                }
                // ========================= 【核心修改 - 開始】 =========================
                else if (type === 'DELETE') {
                    // 新行為: 刪除已確認的紀錄，並嘗試將其還原為一筆待確認紀錄，如果已存在則忽略
                    dbOps.push({ 
                        sql: 'DELETE FROM user_dividends WHERE id = ? AND uid = ?', 
                        params: [divData.id, uid] 
                    });
                    dbOps.push({
                        sql: 'INSERT OR IGNORE INTO user_pending_dividends (uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        params: [
                            uid,
                            divData.symbol,
                            divData.ex_dividend_date,
                            divData.pay_date, // 保留原始的發放日
                            divData.amount_per_share,
                            divData.quantity_at_ex_date,
                            divData.currency
                        ]
                    });
                }
                // ========================= 【核心修改 - 結束】 =========================
                break;

            case 'group':
                const groupData = groupSchema.parse(payload);
                if (type === 'CREATE') {
                    dbOps.push({ sql: 'INSERT INTO groups (id, uid, name, description) VALUES (?, ?, ?, ?)', params: [groupData.id, uid, groupData.name, groupData.description] });
                } else if (type === 'UPDATE') {
                    dbOps.push({ sql: 'UPDATE groups SET name = ?, description = ? WHERE id = ? AND uid = ?', params: [groupData.name, groupData.description, groupData.id, uid] });
                    groupsToRecalculate.add(groupData.id);
                } else if (type === 'DELETE') {
                    dbOps.push({ sql: 'DELETE FROM groups WHERE id = ? AND uid = ?', params: [groupData.id, uid] });
                    dbOps.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE group_id = ? AND uid = ?', params: [groupData.id, uid] });
                    dbOps.push({ sql: 'DELETE FROM group_cache WHERE group_id = ? AND uid = ?', params: [groupData.id, uid] });
                }
                break;
            
            case 'group_inclusion':
                const { groupId, transactionIds, included } = payload;
                if (included) {
                    for (const txId of transactionIds) {
                        dbOps.push({ sql: 'INSERT OR IGNORE INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)', params: [uid, groupId, txId] });
                    }
                } else {
                    const placeholders = transactionIds.map(() => '?').join(',');
                    dbOps.push({ sql: `DELETE FROM group_transaction_inclusions WHERE uid = ? AND group_id = ? AND transaction_id IN (${placeholders})`, params: [uid, groupId, ...transactionIds] });
                }
                groupsToRecalculate.add(groupId);
                break;
        }
    }

    try {
        if (dbOps.length > 0) {
            await d1Client.batch(dbOps);
        }

        // 標記受影響的群組為 dirty
        if (symbolsToInvalidate.size > 0) {
            await markAssociatedGroupsAsDirtyBySymbol(uid, Array.from(symbolsToInvalidate), d1Client);
        }
        for (const groupId of groupsToRecalculate) {
            await d1Client.query('UPDATE groups SET is_dirty = 1 WHERE id = ? AND uid = ?', [groupId, uid]);
        }

        // 觸發背景重算 (非同步，不等待其完成)
        performRecalculation(uid, null, false).catch(err => {
            console.error(`[${uid}] UID 的背景批次重算失敗:`, err);
        });

        // 立即回傳成功，讓前端感覺流暢
        return res.status(200).send({ success: true, message: '操作已成功提交，後端將在背景更新數據。' });

    } catch (error) {
        console.error('批次處理時資料庫操作失敗:', error);
        return res.status(500).send({ success: false, message: `資料庫操作失敗: ${error.message}` });
    }
};
