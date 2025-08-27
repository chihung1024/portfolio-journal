// =========================================================================================
// == 批次操作處理模組 (batch.handler.js) - v2.3 (Complex Action Handling)
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
    
    // 【核心修正】對於帶有特殊動作的 payload，先過濾掉附加元數據
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
            delete cleanPayload.id;
            const fields = Object.keys(cleanPayload);
            const setClause = fields.map(f => `${f} = ?`).join(', ');
            const params = [...fields.map(f => cleanPayload[f]), payload.id, uid];
            return {
                sql: `UPDATE ${tableName} SET ${setClause} WHERE id = ? AND uid = ?`,
                params
            };
        }

        case 'CREATE': {
            const createPayload = { ...cleanPayload, uid, id: newId };
            delete createPayload.id; // 從 payload 移除，因 id 在 SQL 中單獨處理
            if (payload.id && String(payload.id).startsWith('temp_')) {
                 // 確保臨時ID不被寫入
            }
             createPayload.id = newId;


            const createFields = Object.keys(createPayload);
            const placeholders = createFields.map(() => '?').join(', ');
            return {
                sql: `INSERT INTO ${tableName} (${createFields.join(', ')}) VALUES (${placeholders})`,
                params: Object.values(createPayload)
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
            // ========================= 【核心修改 - 開始】 =========================
            // 增加一個特殊處理分支來處理帶有群組歸因的新增交易
            if (action.entity === 'transaction' && action.payload._special_action === 'CREATE_TX_WITH_ATTRIBUTION') {
                const { payload } = action;
                const newTxId = uuidv4();
                tempIdMap[payload.id] = newTxId;

                // 1. (可選) 建立新群組
                const newGroupIdMap = {};
                if (payload.newGroups && payload.newGroups.length > 0) {
                    payload.newGroups.forEach(group => {
                        const newGroupId = uuidv4();
                        newGroupIdMap[group.tempId] = newGroupId;
                        tempIdMap[group.tempId] = newGroupId; // 將新群組的 ID 映射也加入
                        statements.push({
                            sql: `INSERT INTO groups (id, uid, name, description, is_dirty) VALUES (?, ?, ?, ?, 1)`,
                            params: [newGroupId, uid, group.name, '']
                        });
                    });
                }

                // 2. 準備並插入交易數據
                let txData = { ...payload };
                delete txData.groupInclusions;
                delete txData.newGroups;
                delete txData._special_action;
                txData = await populateSettlementFxRate(txData);
                
                statements.push({
                    sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    params: [newTxId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
                });

                // 3. 建立交易與群組的關聯
                if (payload.groupInclusions && payload.groupInclusions.length > 0) {
                    payload.groupInclusions.forEach(groupId => {
                        const finalGroupId = newGroupIdMap[groupId] || groupId;
                        statements.push({
                            sql: `INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)`,
                            params: [uid, finalGroupId, newTxId]
                        });
                    });
                }

            } else { // 對於所有其他常規操作
                const { type } = action;
                let permanentId = null;

                if (type === 'CREATE') {
                    permanentId = uuidv4();
                    const tempId = action.payload.id;
                    if (tempId && String(tempId).startsWith('temp_')) {
                        tempIdMap[tempId] = permanentId;
                    }
                }
                
                if (action.entity === 'transaction') {
                    action.payload = await populateSettlementFxRate(action.payload);
                }

                const { sql, params } = getQueryForAction(uid, action, permanentId);
                statements.push({ sql, params });
            }
             // ========================= 【核心修改 - 結束】 =========================
        }


        if (statements.length > 0) {
            await d1Client.batch(statements);
        }

        await performRecalculation(uid, null, false);
        
        const [txs, splits, holdings, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
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
