// =========================================================================================
// == 批次操作處理模組 (batch.handler.js) - v2.4 (Fix New Group & Return Groups)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { populateSettlementFxRate } = require('./transaction.handler'); 

/**
 * 根據操作類型和實體，產生對應的 SQL 查詢語句。
 */
const getQueryForAction = (uid, action, newId = null) => {
    const { type, entity, payload } = action;
    
    const cleanPayload = { ...payload };
    delete cleanPayload.groupInclusions;
    delete cleanPayload.newGroups;
    delete cleanPayload._special_action;
    
    const tableMap = {
        'transaction': 'transactions',
        'split': 'splits',
        'dividend': 'user_dividends',
        'group': 'groups'
    };
    const tableName = tableMap[entity];
    if (!tableName) throw new Error(`Unsupported entity type: ${entity}`);

    switch (type) {
        case 'DELETE':
            return {
                sql: `DELETE FROM ${tableName} WHERE id = ? AND uid = ?`,
                params: [cleanPayload.id, uid]
            };

        case 'UPDATE': {
            const updatePayload = { ...cleanPayload };
            delete updatePayload.id;
            const fields = Object.keys(updatePayload);
            const setClause = fields.map(f => `${f} = ?`).join(', ');
            const params = [...fields.map(f => updatePayload[f]), payload.id, uid];
            return {
                sql: `UPDATE ${tableName} SET ${setClause} WHERE id = ? AND uid = ?`,
                params
            };
        }

        case 'CREATE': {
            const createPayload = { ...cleanPayload };
            delete createPayload.id; 
            
            const finalPayload = { id: newId, uid, ...createPayload };
            const createFields = Object.keys(finalPayload);
            const placeholders = createFields.map(() => '?').join(', ');
            return {
                sql: `INSERT INTO ${tableName} (${createFields.join(', ')}) VALUES (${placeholders})`,
                params: Object.values(finalPayload)
            };
        }
            
        default:
            throw new Error(`Unsupported action type: ${type}`);
    }
};

/**
 * 接收並處理前端發送的批次操作
 */
exports.submitBatch = async (uid, data, res) => {
    const actions = data.actions;

    if (!Array.isArray(actions) || actions.length === 0) {
        return res.status(200).send({ success: true, message: '沒有需要提交的操作。' });
    }

    try {
        const tempIdMap = {};
        const statements = [];

        for (const action of actions) {
            if (action.entity === 'transaction' && action.payload._special_action === 'CREATE_TX_WITH_ATTRIBUTION') {
                const { payload } = action;
                const newTxId = uuidv4();
                tempIdMap[payload.id] = newTxId;

                const newGroupIdMap = {};
                if (payload.newGroups && payload.newGroups.length > 0) {
                    payload.newGroups.forEach(group => {
                        const newGroupId = uuidv4();
                        newGroupIdMap[group.tempId] = newGroupId;
                        tempIdMap[group.tempId] = newGroupId;
                        statements.push({
                            sql: `INSERT INTO groups (id, uid, name, description, is_dirty) VALUES (?, ?, ?, ?, 1)`,
                            params: [newGroupId, uid, group.name, '']
                        });
                    });
                }

                let txData = { ...payload };
                delete txData.groupInclusions;
                delete txData.newGroups;
                delete txData._special_action;
                delete txData.id;
                txData = await populateSettlementFxRate(txData);
                
                statements.push({
                    sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    params: [newTxId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
                });

                if (payload.groupInclusions && payload.groupInclusions.length > 0) {
                    payload.groupInclusions.forEach(groupId => {
                        const finalGroupId = newGroupIdMap[groupId] || groupId;
                        statements.push({
                            sql: `INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)`,
                            params: [uid, finalGroupId, newTxId]
                        });
                    });
                }

            } else {
                const { type } = action;
                let permanentId = null;

                if (type === 'CREATE') {
                    permanentId = uuidv4();
                    const tempId = action.payload.id;
                    if (tempId && String(tempId).startsWith('temp_')) {
                        tempIdMap[tempId] = permanentId;
                    }
                }
                
                if (action.entity === 'transaction' && ['CREATE', 'UPDATE'].includes(type)) {
                    action.payload = await populateSettlementFxRate(action.payload);
                }

                const { sql, params } = getQueryForAction(uid, action, permanentId);
                statements.push({ sql, params });
            }
        }


        if (statements.length > 0) {
            await d1Client.batch(statements);
        }

        await performRecalculation(uid, null, false);
        
        // 【核心修改】提交並重算後，一次性獲取所有最新數據回傳給前端
        const [txs, splits, holdings, summaryResult, groups] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM groups WHERE uid = ? ORDER BY created_at DESC', [uid]) // <-- 新增
        ]);

        const summaryRow = summaryResult[0] || {};
        const summaryData = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
        const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
        const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
        const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
        const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {};

        
        return res.status(200).send({ 
            success: true, 
            message: '批次操作成功，並已完成數據同步。',
            data: {
                summary: summaryData,
                holdings,
                transactions: txs,
                splits,
                groups, // <-- 新增
                history,
                twrHistory,
                benchmarkHistory,
                netProfitHistory,
                tempIdMap: tempIdMap 
            }
        });

    } catch (error) {
        console.error(`[${uid}] 執行批次提交時發生錯誤:`, error);
        return res.status(500).send({ success: false, message: `批次提交失敗: ${error.message}` });
    }
};
