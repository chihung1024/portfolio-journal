// =========================================================================================
// == 批次操作處理模組 (batch.handler.js) - 【新檔案】
// == 職責：接收前端暫存區的淨操作，以原子方式更新資料庫，並觸發全局重算。
// =========================================================================================

const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');

/**
 * 根據操作類型和實體，產生對應的 SQL 查詢語句。
 * @param {string} uid - 使用者 ID
 * @param {object} action - 包含 type, entity, payload 的操作物件
 * @returns {{sql: string, params: Array}} - SQL 語句和參數
 */
const getQueryForAction = (uid, action) => {
    const { type, entity, payload } = action;
    
    // 將實體名稱轉換為資料庫表名 (簡易規則)
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
            delete updatePayload.id; // 從 payload 中移除 id，id 用於 WHERE 條件
            const fields = Object.keys(updatePayload);
            const setClause = fields.map(f => `${f} = ?`).join(', ');
            const params = [...fields.map(f => updatePayload[f]), payload.id, uid];
            return {
                sql: `UPDATE ${tableName} SET ${setClause} WHERE id = ? AND uid = ?`,
                params
            };
        }

        case 'CREATE': {
            const createPayload = { ...payload, uid }; // 確保 uid 被加入
            if (String(createPayload.id).startsWith('temp_')) {
                delete createPayload.id;
            }
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
        // 按照安全的順序處理操作：刪除 -> 更新 -> 新增
        const deletes = actions.filter(a => a.type === 'DELETE');
        const updates = actions.filter(a => a.type === 'UPDATE');
        const creates = actions.filter(a => a.type === 'CREATE');
        const orderedActions = [...deletes, ...updates, ...creates];

        const statements = orderedActions.map(action => {
            const { sql, params } = getQueryForAction(uid, action);
            return { sql, params };
        });
        
        // 使用 D1 的 batch 功能在一個事務中執行所有語句
        if (statements.length > 0) {
            await d1Client.batch(statements);
        }

        // 所有資料庫操作成功後，觸發一次全局重算
        // 注意：這裡不傳入特定日期，表示需要從頭計算
        await performRecalculation(uid, null, false);
        
        // 【重要】在重算後，重新從資料庫獲取最新的完整數據並回傳給前端
        // 這樣前端在提交成功後，可以一次性刷新整個應用的狀態
        const [txs, splits, holdings, summaryResult, stockNotes] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid]) // 雖然筆記功能刪了，但表可能還在
        ]);

        const summaryRow = summaryResult[0] || {};
        const summaryData = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
        // ... (其他歷史數據的解析)

        return res.status(200).send({ 
            success: true, 
            message: '批次操作成功，並已完成數據同步。',
            // 回傳最新、最完整的數據
            data: {
                summary: summaryData,
                holdings,
                transactions: txs,
                splits,
                stockNotes
                // 也可以在此處回傳 history, twrHistory 等圖表數據
            }
        });

    } catch (error) {
        console.error(`[${uid}] 執行批次提交時發生錯誤:`, error);
        return res.status(500).send({ success: false, message: `批次提交失敗: ${error.message}` });
    }
};