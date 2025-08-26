// =========================================================================================
// == 同步操作處理模組 (sync.handler.js) - v1.2.0 (支援複合式交易建立)
// == 職責：接收並處理前端的操作隊列，執行批次資料庫操作，並觸發一次性的重算。
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const transactionHandler = require('./transaction.handler'); 

/**
 * 處理前端發送的操作隊列
 */
exports.syncOperations = async (uid, data, res) => {
    const { op_queue } = data;
    if (!op_queue || !Array.isArray(op_queue) || op_queue.length === 0) {
        return res.status(400).send({ success: false, message: '操作隊列為空或格式不正確。' });
    }

    console.log(`[${uid}] [Sync] 收到 ${op_queue.length} 筆操作，開始處理...`);

    const dbOps = [];
    const tempIdMap = new Map(); 
    let modifiedDate = null; 
    const groupsToMarkDirty = new Set();

    for (const op of op_queue) {
        const { op: operation, entity, payload } = op;
        
        const resolveId = (tempId) => tempIdMap.has(tempId) ? tempIdMap.get(tempId) : tempId;

        if (payload.date && (!modifiedDate || payload.date < modifiedDate)) {
            modifiedDate = payload.date;
        }

        switch (entity) {
            case 'transaction':
                if (operation === 'CREATE') {
                    const newTxId = uuidv4();
                    // 注意：前端發送的 payload 可能包含 isTemporary, id 等臨時屬性，這裡只取 txData
                    const txData = await transactionHandler.populateSettlementFxRate(payload.txData);
                    
                    dbOps.push({
                        sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        params: [newTxId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
                    });

                    // ========================= 【核心修改 - 開始】 =========================
                    // 處理伴隨交易而來的新群組和歸屬關係
                    const newGroupIdMap = new Map();
                    if (payload.newGroups && payload.newGroups.length > 0) {
                        payload.newGroups.forEach(group => {
                            const newGroupId = uuidv4();
                            newGroupIdMap.set(group.tempId, newGroupId);
                            groupsToMarkDirty.add(newGroupId); // 新群組本身不需要標記
                            dbOps.push({
                                sql: `INSERT INTO groups (id, uid, name, description, is_dirty) VALUES (?, ?, ?, ?, 1)`,
                                params: [newGroupId, uid, group.name, '']
                            });
                        });
                    }

                    if (payload.groupInclusions && payload.groupInclusions.length > 0) {
                        payload.groupInclusions.forEach(groupId => {
                            const finalGroupId = newGroupIdMap.has(groupId) ? newGroupIdMap.get(groupId) : groupId;
                            groupsToMarkDirty.add(finalGroupId);
                            dbOps.push({
                                sql: `INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)`,
                                params: [uid, finalGroupId, newTxId]
                            });
                        });
                    }
                    // ========================= 【核心修改 - 結束】 =========================

                } else if (operation === 'UPDATE') {
                    const txData = await transactionHandler.populateSettlementFxRate(payload.txData);
                    dbOps.push({
                        sql: `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
                        params: [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, payload.txId, uid]
                    });
                } else if (operation === 'DELETE') {
                     dbOps.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?', params: [uid, payload.txId] });
                     dbOps.push({ sql: 'DELETE FROM transactions WHERE id = ? AND uid = ?', params: [payload.txId, uid] });
                }
                break;

            case 'split':
                 if (operation === 'CREATE') {
                    const newId = uuidv4();
                    tempIdMap.set(payload.id, newId);
                    dbOps.push({ sql: `INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`, params: [newId, uid, payload.date, payload.symbol, payload.ratio] });
                } else if (operation === 'DELETE') {
                    dbOps.push({ sql: 'DELETE FROM splits WHERE id = ? AND uid = ?', params: [payload.splitId, uid] });
                }
                break;

            case 'user_dividend':
                if (operation === 'CREATE' || operation === 'UPDATE') {
                    const dividendId = operation === 'CREATE' ? uuidv4() : payload.id;
                    if(operation === 'CREATE') tempIdMap.set(payload.id, dividendId);
                    
                    dbOps.push({ sql: 'DELETE FROM user_pending_dividends WHERE uid = ? AND symbol = ? AND ex_dividend_date = ?', params: [uid, payload.symbol, payload.ex_dividend_date] });
                    dbOps.push({
                        sql: `INSERT OR REPLACE INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
                        params: [dividendId, uid, payload.symbol, payload.ex_dividend_date, payload.pay_date, payload.amount_per_share, payload.quantity_at_ex_date, payload.total_amount, payload.tax_rate, payload.currency, payload.notes]
                    });
                } else if (operation === 'DELETE') {
                    dbOps.push({ sql: 'DELETE FROM user_dividends WHERE id = ? AND uid = ?', params: [payload.dividendId, uid] });
                }
                break;
            
            case 'stock_note':
                dbOps.push({
                    sql: `INSERT OR REPLACE INTO user_stock_notes (id, uid, symbol, target_price, stop_loss_price, notes, last_updated) VALUES ((SELECT id FROM user_stock_notes WHERE uid = ? AND symbol = ?), ?, ?, ?, ?, ?, ?)`,
                    params: [uid, payload.symbol, uid, payload.symbol, payload.target_price, payload.stop_loss_price, payload.notes, new Date().toISOString()]
                });
                break;

            case 'group':
                if (operation === 'CREATE' || operation === 'UPDATE') {
                    const groupId = (operation === 'CREATE') ? uuidv4() : resolveId(payload.id);
                    if(operation === 'CREATE') tempIdMap.set(payload.id, groupId);

                    dbOps.push({ sql: `INSERT OR REPLACE INTO groups (id, uid, name, description, is_dirty) VALUES (?, ?, ?, ?, 1)`, params: [groupId, uid, payload.name, payload.description] });
                    dbOps.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND group_id = ?', params: [uid, groupId] });
                    if (payload.transactionIds && payload.transactionIds.length > 0) {
                        payload.transactionIds.forEach(txId => {
                            dbOps.push({
                                sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)',
                                params: [uid, groupId, resolveId(txId)]
                            });
                        });
                    }
                } else if (operation === 'DELETE') {
                    const groupId = resolveId(payload.groupId);
                    dbOps.push({ sql: 'DELETE FROM group_cache WHERE group_id = ? AND uid = ?', params: [groupId, uid] });
                    dbOps.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE group_id = ? AND uid = ?', params: [groupId, uid] });
                    dbOps.push({ sql: 'DELETE FROM groups WHERE id = ? AND uid = ?', params: [groupId, uid] });
                }
                break;
            
            case 'transaction_group_membership':
                if (operation === 'UPDATE') {
                    const { transactionId, groupIds } = payload;
                    
                    const oldGroupsResult = await d1Client.query('SELECT group_id FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?', [uid, transactionId]);
                    oldGroupsResult.forEach(row => groupsToMarkDirty.add(row.group_id));

                    groupIds.forEach(gid => groupsToMarkDirty.add(gid));

                    dbOps.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?', params: [uid, transactionId] });
                    if (groupIds && groupIds.length > 0) {
                        groupIds.forEach(groupId => {
                            dbOps.push({
                                sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)',
                                params: [uid, groupId, transactionId]
                            });
                        });
                    }
                }
                break;
        }
    }
    
    if (groupsToMarkDirty.size > 0) {
        const groupIds = Array.from(groupsToMarkDirty);
        const placeholders = groupIds.map(() => '?').join(',');
        dbOps.push({
            sql: `UPDATE groups SET is_dirty = 1 WHERE uid = ? AND id IN (${placeholders})`,
            params: [uid, ...groupIds]
        });
    }

    if (dbOps.length > 0) {
        await d1Client.batch(dbOps);
    }
    
    await performRecalculation(uid, null, false);
    
    const portfolioData = await require('./portfolio.handler').getData(uid, null);

    console.log(`[${uid}] [Sync] ${op_queue.length} 筆操作處理完成。`);

    return res.status(200).send({
        success: true,
        message: '同步成功！',
        data: portfolioData.data
    });
};
