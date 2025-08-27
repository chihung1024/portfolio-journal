// =========================================================================================
// == 批次操作處理模組 (batch.handler.js) - v4.0 (Decoupled & Atomic)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { populateSettlementFxRate } = require('./transaction.handler');
const { calculateGroupOnDemandCore } = require('./group.handler');
const { updateBenchmarkCore } = require('./portfolio.handler');


/**
 * 處理標準的批次提交操作
 * @param {string} uid - 使用者 ID
 * @param {Array} actions - 前端傳來的操作陣列
 * @returns {Promise<object>} - 回傳包含 tempIdMap 的物件
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
 * 【重構】API 端點：只處理批次提交，並回傳最小化響應
 */
exports.submitBatch = async (uid, data, res) => {
    try {
        const { tempIdMap } = await processBatchActions(uid, data.actions);
        
        // 批次提交成功後，觸發一次全局重算
        // 注意：這是一個非同步操作，API 會立即回傳，不會等待重算完成
        performRecalculation(uid, null, false).catch(err => {
            // 即使重算失敗，也只在後端記錄錯誤，不影響 API 的成功響應
            console.error(`[${uid}] 背景執行 submitBatch 重算時發生錯誤:`, err);
        });

        // ========================= 【核心修改 - 開始】 =========================
        // 移除所有數據查詢邏輯，只回傳成功訊息和 tempIdMap
        return res.status(200).send({ 
            success: true, 
            message: '批次操作已成功提交，後端正在更新數據。',
            data: {
                tempIdMap: tempIdMap 
            }
        });
        // ========================= 【核心修改 - 結束】 =========================

    } catch (error) {
        console.error(`[${uid}] 執行 submitBatch 時發生錯誤:`, error);
        return res.status(500).send({ success: false, message: `批次提交失敗: ${error.message}` });
    }
};


// ========================= 【核心修改 - 開始】 =========================
/**
 * 【廢除】移除 submitBatchAndExecute 函式
 * 這個函式將寫入和讀取操作緊密耦合，是造成數據不一致 Bug 的根源。
 * 其邏輯將被拆分到前端，由前端主導 "提交 -> 刷新 -> 計算" 的流程。
 */
// exports.submitBatchAndExecute = async (uid, data, res) => { ... };
// ========================= 【核心修改 - 結束】 =========================