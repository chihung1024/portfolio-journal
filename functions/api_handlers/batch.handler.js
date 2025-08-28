// =========================================================================================
// == 批次操作處理模組 (batch.handler.js) - v3.3 (Group View Sync)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { populateSettlementFxRate } = require('../services/transaction.service');
const { calculateGroupOnDemandCore } = require('./group.handler');
const { updateBenchmarkCore } = require('./portfolio.handler');


/**
 * 處理標準的批次提交操作
 * @param {string} uid - 使用者 ID
 * @param {Array} actions - 前端傳來的操作陣列
 * @returns {Promise<object>} - 回傳包含 tempIdMap 和 statement 的物件
 */
async function processBatchActions(uid, actions) {
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

            const { entity, payload } = action;
            const cleanPayload = { ...payload };
            delete cleanPayload.groupInclusions;
            delete cleanPayload.newGroups;
            delete cleanPayload._special_action;
            const tableMap = { 'transaction': 'transactions', 'split': 'splits', 'dividend': 'user_dividends', 'group': 'groups' };
            const tableName = tableMap[entity];
            if (!tableName) throw new Error(`Unsupported entity type: ${entity}`);

            let sql, params;
            switch (type) {
                case 'DELETE':
                    sql = `DELETE FROM ${tableName} WHERE id = ? AND uid = ?`;
                    params = [cleanPayload.id, uid];
                    break;
                case 'UPDATE': {
                    const updatePayload = { ...cleanPayload };
                    delete updatePayload.id;
                    const fields = Object.keys(updatePayload);
                    const setClause = fields.map(f => `${f} = ?`).join(', ');
                    sql = `UPDATE ${tableName} SET ${setClause} WHERE id = ? AND uid = ?`;
                    params = [...fields.map(f => updatePayload[f]), payload.id, uid];
                    break;
                }
                case 'CREATE': {
                    const createPayload = { ...cleanPayload };
                    delete createPayload.id; 
                    const finalPayload = { id: permanentId, uid, ...createPayload };
                    const createFields = Object.keys(finalPayload);
                    const placeholders = createFields.map(() => '?').join(', ');
                    sql = `INSERT INTO ${tableName} (${createFields.join(', ')}) VALUES (${placeholders})`;
                    params = Object.values(finalPayload);
                    break;
                }
                default:
                    throw new Error(`Unsupported action type: ${type}`);
            }
            statements.push({ sql, params });
        }
    }
    
    if (statements.length > 0) {
        await d1Client.batch(statements);
    }

    return { tempIdMap };
}


/**
 * 【舊 API 端點】只處理批次提交
 */
exports.submitBatch = async (uid, data, res) => {
    try {
        const { tempIdMap } = await processBatchActions(uid, data.actions);
        await performRecalculation(uid, null, false);
        
        const [txs, splits, holdings, summaryResult, groups] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM groups WHERE uid = ? ORDER BY created_at DESC', [uid])
        ]);

        const summaryRow = summaryResult[0] || {};
        const summaryData = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};

        return res.status(200).send({ 
            success: true, 
            message: '批次操作成功。',
            data: {
                summary: summaryData, holdings, transactions: txs, splits, groups,
                tempIdMap: tempIdMap 
            }
        });
    } catch (error) {
        console.error(`[${uid}] 執行 submitBatch 時發生錯誤:`, error);
        return res.status(500).send({ success: false, message: `批次提交失敗: ${error.message}` });
    }
};


/**
 * 【新 API 端點】合併提交與後續計算
 */
exports.submitBatchAndExecute = async (uid, data, res) => {
    const { actions, nextAction } = data;

    try {
        const { tempIdMap } = await processBatchActions(uid, actions);
        let resultData;

        if (nextAction) {
            switch (nextAction.type) {
                // ========================= 【核心修改 - 開始】 =========================
                case 'CALCULATE_GROUP': {
                    console.log(`[Combined Action] 提交後，接續計算群組: ${nextAction.payload.groupId}`);
                    resultData = await calculateGroupOnDemandCore(uid, nextAction.payload.groupId);
                    
                    // Bug Fix: 確保即使群組計算完成後，也能取得最新的全局 splits 和 groups 列表
                    // 這樣可以避免前端在更新時因缺少最新數據而出錯
                    const [splits, groups] = await Promise.all([
                        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
                        d1Client.query('SELECT * FROM groups WHERE uid = ? ORDER BY created_at DESC', [uid])
                    ]);
                    
                    // transactions 已經由 calculateGroupOnDemandCore 正確回傳，這裡只需補充其他全局數據
                    resultData.splits = splits;
                    resultData.groups = groups;
                    break;
                }
                // ========================= 【核心修改 - 結束】 =========================
                
                case 'UPDATE_BENCHMARK': {
                    console.log(`[Combined Action] 提交後，接續更新 Benchmark 為: ${nextAction.payload.benchmarkSymbol}`);
                    await updateBenchmarkCore(uid, nextAction.payload.benchmarkSymbol);
                    const [txs, splits, holdings, summaryResult, groups] = await Promise.all([
                        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
                        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
                        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
                        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
                        d1Client.query('SELECT * FROM groups WHERE uid = ? ORDER BY created_at DESC', [uid])
                    ]);
                    const summaryRow = summaryResult[0] || {};
                    resultData = {
                        summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
                        history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
                        twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
                        benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
                        netProfitHistory: summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {},
                        holdings, transactions: txs, splits, groups,
                    };
                    break;
                }
                
                default:
                    await performRecalculation(uid, null, false);
                    break;
            }
        } else {
            await performRecalculation(uid, null, false);
        }

        if (!resultData) {
             const [txs, splits, holdings, summaryResult, groups] = await Promise.all([
                d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
                d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
                d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
                d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
                d1Client.query('SELECT * FROM groups WHERE uid = ? ORDER BY created_at DESC', [uid])
            ]);
            const summaryRow = summaryResult[0] || {};
            resultData = { 
                summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
                holdings, transactions: txs, splits, groups 
            };
        }

        return res.status(200).send({
            success: true,
            message: '組合操作成功。',
            data: {
                ...resultData,
                tempIdMap: tempIdMap
            }
        });

    } catch (error) {
        console.error(`[${uid}] 執行 submitBatchAndExecute 時發生錯誤:`, error);
        return res.status(500).send({ success: false, message: `組合操作失敗: ${error.message}` });
    }
};
