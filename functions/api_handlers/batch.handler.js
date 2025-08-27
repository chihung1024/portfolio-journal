// =========================================================================================
// == 批次操作處理模組 (batch.handler.js) - v3.0 (Combined Actions)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { populateSettlementFxRate } = require('./transaction.handler');
// 【新增】導入重構後的核心邏輯函式
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

            // 這段 getQueryForAction 應該要重構，但暫時保留以求穩定
            // START of getQueryForAction logic
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
            // END of getQueryForAction logic
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
        // 批次提交後，總是觸發一次全局重算
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
        // ... (省略 history 的解析，因為前端不需要立即用)

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


// ========================= 【核心修改 - 開始】 =========================
/**
 * 【新 API 端點】合併提交與後續計算
 */
exports.submitBatchAndExecute = async (uid, data, res) => {
    const { actions, nextAction } = data;

    try {
        // 步驟 1: 先執行標準的批次提交資料庫操作
        const { tempIdMap } = await processBatchActions(uid, actions);

        let resultData;

        // 步驟 2: 根據 nextAction 參數，執行對應的後續計算
        if (nextAction) {
            switch (nextAction.type) {
                case 'CALCULATE_GROUP':
                    console.log(`[Combined Action] 提交後，接續計算群組: ${nextAction.payload.groupId}`);
                    resultData = await calculateGroupOnDemandCore(uid, nextAction.payload.groupId);
                    break;
                
                case 'UPDATE_BENCHMARK':
                    console.log(`[Combined Action] 提交後，接續更新 Benchmark 為: ${nextAction.payload.benchmarkSymbol}`);
                    await updateBenchmarkCore(uid, nextAction.payload.benchmarkSymbol);
                    // 更新 benchmark 後，需要回傳全局 ('all') 的數據
                    // 我們可以透過呼叫 get_data 的核心邏輯來達成
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
                
                default:
                    // 如果 nextAction 無效，則執行標準的全局重算
                    await performRecalculation(uid, null, false);
                    break;
            }
        } else {
            // 如果沒有 nextAction，則行為與舊的 submitBatch 相同
            await performRecalculation(uid, null, false);
        }

        if (!resultData) {
            // 如果前面的流程沒有產生 resultData (例如預設情況)，則重新獲取全局數據
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

        // 步驟 3: 將最終計算結果與 tempIdMap 一併回傳
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
// ========================= 【核心修改 - 結束】 =========================
