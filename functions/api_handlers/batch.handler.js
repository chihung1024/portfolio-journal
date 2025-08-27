// =========================================================================================
// == 批次操作處理模組 (batch.handler.js) - v4.0 (Robust & Atomic)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { populateSettlementFxRate } = require('./transaction.handler');
const { calculateGroupOnDemandCore } = require('./group.handler');
const { updateBenchmarkCore } = require('./portfolio.handler');

/**
 * 【核心重構】處理批次提交操作 (v4.0)
 * @param {string} uid - 使用者 ID
 * @param {Array} actions - 前端傳來的操作陣列
 * @returns {Promise<object>} - 回傳包含 tempIdMap 的物件
 */
async function processBatchActions(uid, actions) {
    const tempIdMap = {};
    const statements = [];

    // ========================= 【核心修改 - 開始】 =========================
    // 我們將整個邏輯重構，使其更具可讀性和穩健性

    for (const action of actions) {
        const { type, entity, payload } = action;

        // --- 1. 處理 CREATE 操作 ---
        if (type === 'CREATE') {
            const permanentId = uuidv4();
            if (payload.id && String(payload.id).startsWith('temp_')) {
                tempIdMap[payload.id] = permanentId;
            }

            // 特殊處理：帶有群組歸因的新交易
            if (entity === 'transaction' && payload._special_action === 'CREATE_TX_WITH_ATTRIBUTION') {
                // 處理新群組的建立
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

                // 準備並插入交易紀錄
                let txData = { ...payload };
                delete txData.id;
                delete txData.groupInclusions;
                delete txData.newGroups;
                delete txData._special_action;
                delete txData._staging_status;
                
                txData = await populateSettlementFxRate(txData);
                
                statements.push({
                    sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    params: [permanentId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
                });

                // 處理群組歸屬
                if (payload.groupInclusions && payload.groupInclusions.length > 0) {
                    payload.groupInclusions.forEach(groupId => {
                        const finalGroupId = newGroupIdMap[groupId] || groupId;
                        statements.push({
                            sql: `INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)`,
                            params: [uid, finalGroupId, permanentId]
                        });
                    });
                }
            } else {
                // 通用的 CREATE 操作
                const tableMap = { 'transaction': 'transactions', 'split': 'splits', 'dividend': 'user_dividends', 'group': 'groups' };
                const tableName = tableMap[entity];
                if (!tableName) continue;
                
                let createPayload = { ...payload };
                delete createPayload.id;
                delete createPayload._staging_status;
                
                if (entity === 'transaction') {
                    createPayload = await populateSettlementFxRate(createPayload);
                }
                
                const finalPayload = { id: permanentId, uid, ...createPayload };
                const fields = Object.keys(finalPayload);
                const placeholders = fields.map(() => '?').join(', ');
                statements.push({
                    sql: `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`,
                    params: Object.values(finalPayload)
                });
            }
        }
        
        // --- 2. 處理 UPDATE 操作 ---
        else if (type === 'UPDATE') {
            const tableMap = { 'transaction': 'transactions', 'split': 'splits', 'dividend': 'user_dividends', 'group': 'groups' };
            const tableName = tableMap[entity];
            if (!tableName) continue;

            let updatePayload = { ...payload };
            delete updatePayload.id;
            delete updatePayload._staging_status; // 移除前端專用的狀態欄位

            if (entity === 'transaction') {
                updatePayload = await populateSettlementFxRate(updatePayload);
            }

            const fields = Object.keys(updatePayload);
            const setClause = fields.map(f => `${f} = ?`).join(', ');

            statements.push({
                sql: `UPDATE ${tableName} SET ${setClause} WHERE id = ? AND uid = ?`,
                params: [...Object.values(updatePayload), payload.id, uid]
            });
        }
        
        // --- 3. 處理 DELETE 操作 ---
        else if (type === 'DELETE') {
            const idToDelete = payload.id;

            // 智慧刪除：根據實體類型，產生所有必要的關聯刪除指令
            if (entity === 'transaction') {
                // 刪除交易時，必須同時刪除其在所有群組中的歸屬紀錄
                statements.push({
                    sql: `DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?`,
                    params: [uid, idToDelete]
                });
                statements.push({
                    sql: `DELETE FROM transactions WHERE id = ? AND uid = ?`,
                    params: [idToDelete, uid]
                });
            } else if (entity === 'group') {
                // 刪除群組時，必須同時刪除其快取、所有成員歸屬、以及群組本身
                statements.push({
                    sql: `DELETE FROM group_cache WHERE uid = ? AND group_id = ?`,
                    params: [uid, idToDelete]
                });
                statements.push({
                    sql: `DELETE FROM group_transaction_inclusions WHERE uid = ? AND group_id = ?`,
                    params: [uid, idToDelete]
                });
                statements.push({
                    sql: `DELETE FROM groups WHERE id = ? AND uid = ?`,
                    params: [idToDelete, uid]
                });
            } else {
                // 對於沒有複雜關聯的實體（如 split, dividend），直接刪除主紀錄
                const tableMap = { 'split': 'splits', 'dividend': 'user_dividends' };
                const tableName = tableMap[entity];
                if (tableName) {
                    statements.push({
                        sql: `DELETE FROM ${tableName} WHERE id = ? AND uid = ?`,
                        params: [idToDelete, uid]
                    });
                }
            }
        }
    }
    // ========================= 【核心修改 - 結束】 =========================
    
    if (statements.length > 0) {
        console.log(`[Batch Handler] Preparing to execute ${statements.length} DB statements.`);
        await d1Client.batch(statements);
    }

    return { tempIdMap };
}


/**
 * 【API 端點】處理批次提交與後續執行
 */
exports.submitBatchAndExecute = async (uid, data, res) => {
    const { actions, nextAction } = data;

    try {
        const { tempIdMap } = await processBatchActions(uid, actions);
        let resultData;

        if (nextAction) {
            switch (nextAction.type) {
                case 'CALCULATE_GROUP':
                    resultData = await calculateGroupOnDemandCore(uid, nextAction.payload.groupId);
                    break;
                case 'UPDATE_BENCHMARK':
                    await updateBenchmarkCore(uid, nextAction.payload.benchmarkSymbol);
                    resultData = await getGlobalPortfolioData(uid);
                    break;
                default:
                    await performRecalculation(uid, null, false);
                    resultData = await getGlobalPortfolioData(uid);
                    break;
            }
        } else {
            await performRecalculation(uid, null, false);
            resultData = await getGlobalPortfolioData(uid);
        }

        return res.status(200).send({
            success: true,
            message: '組合操作成功。',
            data: { ...resultData, tempIdMap }
        });

    } catch (error) {
        console.error(`[${uid}] 執行 submitBatchAndExecute 時發生錯誤:`, error);
        return res.status(500).send({ success: false, message: `組合操作失敗: ${error.message}` });
    }
};

/**
 * 【輔助函式】獲取全局 ('all') 的投資組合數據
 */
async function getGlobalPortfolioData(uid) {
    const [txs, splits, holdings, summaryResult, groups] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM groups WHERE uid = ? ORDER BY created_at DESC', [uid])
    ]);
    const summaryRow = summaryResult[0] || {};
    return {
        summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
        history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
        twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
        benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
        netProfitHistory: summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {},
        holdings, transactions: txs, splits, groups
    };
}


// 【舊 API 端點 - 已整合】現在它只是新端點的一個特例
exports.submitBatch = async (uid, data, res) => {
    const newData = {
        actions: data.actions,
        nextAction: null // 沒有指定 nextAction，將會觸發預設的全局重算
    };
    return await exports.submitBatchAndExecute(uid, newData, res);
};
