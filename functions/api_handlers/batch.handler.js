// =========================================================================================
// == 批次操作處理模組 (batch.handler.js) - v2.0 (Bug Fix - 匯率 & ID 同步)
// =========================================================================================

const { v4: uuidv4 } = require('uuid'); // 【核心修正】
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
// 【核心修正】從 transaction.handler 導入匯率計算函式
const { populateSettlementFxRate } = require('./transaction.handler'); 

/**
 * 根據操作類型和實體，產生對應的 SQL 查詢語句。
 */
const getQueryForAction = (uid, action, newId = null) => {
    const { type, entity, payload } = action;
    
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
                params: [payload.id, uid]
            };

        case 'UPDATE': {
            const updatePayload = { ...payload };
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
            const createPayload = { ...payload, uid, id: newId }; // 使用後端產生的新 ID
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

        // 【核心修正】分階段處理，優先處理 CREATE 操作以建立 ID Map
        const creates = actions.filter(a => a.type === 'CREATE');
        const updates = actions.filter(a => a.type === 'UPDATE');
        const deletes = actions.filter(a => a.type === 'DELETE');

        for (const action of creates) {
            const permanentId = uuidv4();
            const tempId = action.payload.id;
            if (String(tempId).startsWith('temp_')) {
                tempIdMap[tempId] = permanentId;
            }

            // 如果是交易，則先計算匯率
            if (action.entity === 'transaction') {
                action.payload = await populateSettlementFxRate(action.payload);
            }
            
            const { sql, params } = getQueryForAction(uid, action, permanentId);
            statements.push({ sql, params });
        }
        
        // 處理更新和刪除
        [...updates, ...deletes].forEach(action => {
             const { sql, params } = getQueryForAction(uid, action);
             statements.push({ sql, params });
        });

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
        
        return res.status(200).send({ 
            success: true, 
            message: '批次操作成功，並已完成數據同步。',
            data: {
                summary: summaryData,
                holdings,
                transactions: txs,
                splits,
                // 回傳 ID 對照表給前端
                tempIdMap: tempIdMap 
            }
        });

    } catch (error) {
        console.error(`[${uid}] 執行批次提交時發生錯誤:`, error);
        return res.status(500).send({ success: false, message: `批次提交失敗: ${error.message}` });
    }
};
