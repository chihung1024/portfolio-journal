// =========================================================================================
// == [最終修正檔案] 暫存區 API 處理模組 (staging.handler.js) v1.3 - Bulletproof
// == 職責：處理所有與暫存區相關的 API Action，採用絕對穩健的重寫邏輯
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const schemas = require('../schemas');

// 定義暫存變更的操作類型
const changeOperationSchema = z.object({
    op: z.enum(['CREATE', 'UPDATE', 'DELETE']),
    entity: z.enum(['transaction', 'split', 'dividend', 'group_membership']),
    payload: z.any()
});

/**
 * 1. Stage Change API: (此函式邏輯不變)
 */
exports.stageChange = async (uid, data, res) => {
    const { op, entity, payload } = changeOperationSchema.parse(data);
    let validatedPayload;
    let entityId = null;
    switch (`${entity}:${op}`) {
        case 'transaction:CREATE':
            validatedPayload = schemas.transactionSchema.parse(payload);
            break;
        case 'transaction:UPDATE':
            validatedPayload = schemas.transactionSchema.extend({ id: z.string().uuid() }).parse(payload);
            entityId = validatedPayload.id;
            break;
        case 'transaction:DELETE':
            validatedPayload = z.object({ id: z.string().uuid() }).parse(payload);
            entityId = validatedPayload.id;
            break;
        case 'group_membership:UPDATE':
            validatedPayload = z.object({ transactionId: z.string().uuid(), groupIds: z.array(z.string()) }).parse(payload);
            entityId = validatedPayload.transactionId;
            break;
        default:
            return res.status(400).send({ success: false, message: `不支援的操作: ${entity}:${op}` });
    }
    const changeId = uuidv4();
    await d1Client.query(
        `INSERT INTO staged_changes (id, uid, entity_type, operation_type, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?)`,
        [changeId, uid, entity, op, entityId, JSON.stringify(validatedPayload)]
    );
    return res.status(200).send({ success: true, message: '變更已成功暫存。', changeId });
};

/**
 * 2. Get Merged View API: 【防彈重寫】
 */
exports.getTransactionsWithStaging = async (uid, data, res) => {
    try {
        const { page = 1, pageSize = 15 } = z.object({
            page: z.number().int().positive().optional(),
            pageSize: z.number().int().positive().optional()
        }).parse(data || {});

        const [committedTxs, stagedChanges] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND entity_type = 'transaction' ORDER BY created_at ASC`, [uid])
        ]);

        const txMap = new Map(committedTxs.map(tx => [tx.id, { ...tx, status: 'COMMITTED' }]));

        // 【核心修正】第一階段：處理所有 CREATE 和 UPDATE 操作
        for (const change of stagedChanges) {
            if (change.operation_type !== 'CREATE' && change.operation_type !== 'UPDATE') {
                continue;
            }
            try {
                const payload = JSON.parse(change.payload);
                const entityId = change.entity_id || change.id;
                if (!entityId) continue;

                if (change.operation_type === 'CREATE') {
                    txMap.set(entityId, { ...payload, id: entityId, status: 'STAGED_CREATE' });
                } else { // UPDATE
                    const existingTx = txMap.get(entityId);
                    if (existingTx && typeof existingTx === 'object') {
                        txMap.set(entityId, { ...existingTx, ...payload, status: 'STAGED_UPDATE' });
                    }
                }
            } catch (e) {
                console.error(`Error processing CREATE/UPDATE change ${change.id}:`, e);
            }
        }

        // 【核心修正】第二階段：獨立處理所有 DELETE 操作
        for (const change of stagedChanges) {
            if (change.operation_type !== 'DELETE') {
                continue;
            }
            try {
                const payload = JSON.parse(change.payload);
                const entityId = change.entity_id || payload.id;
                if (!entityId) continue;

                const existingTx = txMap.get(entityId);
                // 增加最嚴格的防禦性檢查
                if (existingTx && typeof existingTx === 'object' && existingTx.hasOwnProperty('status')) {
                    if (existingTx.status === 'STAGED_CREATE') {
                        txMap.delete(entityId);
                    } else {
                        existingTx.status = 'STAGED_DELETE';
                    }
                }
            } catch(e) {
                 console.error(`Error processing DELETE change ${change.id}:`, e);
            }
        }

        const mergedTxs = Array.from(txMap.values())
            .filter(tx => tx && tx.status !== 'STAGED_DELETE')
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const offset = (page - 1) * pageSize;
        const paginatedTxs = mergedTxs.slice(offset, offset + pageSize);

        return res.status(200).send({ success: true, data: { transactions: paginatedTxs, hasStagedChanges: stagedChanges.length > 0 } });
    } catch (error) {
        console.error("Critical error in getTransactionsWithStaging:", error);
        return res.status(500).send({ success: false, message: `伺服器處理交易列表時發生嚴重錯誤: ${error.message}` });
    }
};

/**
 * 3. Commit API: (此函式邏輯不變)
 */
exports.commitAllChanges = async (uid, res) => {
    // ... (此函式內容維持不變)
    const pendingChanges = await d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND status = 'PENDING' ORDER BY created_at ASC`, [uid]);
    if (pendingChanges.length === 0) return res.status(200).send({ success: true, message: '沒有待處理的變更。' });
    const batchId = uuidv4();
    const pendingIds = pendingChanges.map(c => c.id);
    const placeholders = pendingIds.map(() => '?').join(',');
    await d1Client.query(`UPDATE staged_changes SET status = 'COMMITTING', batch_id = ? WHERE id IN (${placeholders})`, [batchId, ...pendingIds]);
    try {
        pendingChanges.forEach(change => {
            const payload = JSON.parse(change.payload);
            const { entity_type: entity, operation_type: op } = change;
            switch (`${entity}:${op}`) {
                case 'transaction:CREATE': schemas.transactionSchema.parse(payload); break;
                case 'transaction:UPDATE': schemas.transactionSchema.extend({ id: z.string().uuid() }).parse(payload); break;
                case 'transaction:DELETE': z.object({ id: z.string().uuid() }).parse(payload); break;
                case 'group_membership:UPDATE': z.object({ transactionId: z.string().uuid(), groupIds: z.array(z.string()) }).parse(payload); break;
            }
        });
    } catch (error) {
        await d1Client.query(`UPDATE staged_changes SET status = 'FAILED', error_message = ? WHERE batch_id = ?`, [error.message, batchId]);
        return res.status(400).send({ success: false, message: '提交的變更中有無效數據，請檢查。', error: error.message });
    }
    const dbOperations = [];
    let earliestChangeDate = new Date().toISOString();
    pendingChanges.forEach(change => {
        const payload = JSON.parse(change.payload);
        const date = payload.date || new Date().toISOString();
        if (date < earliestChangeDate) { earliestChangeDate = date; }
        switch (`${change.entity_type}:${change.operation_type}`) {
            case 'transaction:CREATE':
                dbOperations.push({ sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [change.id, uid, payload.date, payload.symbol, payload.type, payload.quantity, payload.price, payload.currency, payload.totalCost, payload.exchangeRate] });
                break;
            case 'transaction:UPDATE':
                dbOperations.push({ sql: `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`, params: [payload.date, payload.symbol, payload.type, payload.quantity, payload.price, payload.currency, payload.totalCost, payload.exchangeRate, payload.id, uid] });
                break;
            case 'transaction:DELETE':
                 dbOperations.push({ sql: 'DELETE FROM transactions WHERE id = ? AND uid = ?', params: [payload.id, uid] });
                 dbOperations.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE transaction_id = ? AND uid = ?', params: [payload.id, uid] });
                break;
            case 'group_membership:UPDATE':
                 dbOperations.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE transaction_id = ? AND uid = ?', params: [payload.transactionId, uid]});
                 payload.groupIds.forEach(groupId => { dbOperations.push({ sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)', params: [uid, groupId, payload.transactionId] }); });
                break;
        }
    });
    dbOperations.push({ sql: `DELETE FROM staged_changes WHERE batch_id = ?`, params: [batchId] });
    try {
        await d1Client.batch(dbOperations);
    } catch (dbError) {
        await d1Client.query(`UPDATE staged_changes SET status = 'FAILED', error_message = ? WHERE batch_id = ?`, [dbError.message, batchId]);
        return res.status(500).send({ success: false, message: '資料庫寫入失敗，您的變更已還原。', error: dbError.message });
    }
    try {
        await performRecalculation(uid, earliestChangeDate, false);
    } catch (recalcError) {
        console.error(`[CRITICAL] UID ${uid}, BatchID ${batchId}: DB commit OK, but recalc failed! Error: ${recalcError.message}`);
        return res.status(500).send({ success: false, message: `資料庫已更新，但績效計算過程中發生錯誤。請聯繫管理員。 Batch ID: ${batchId}` });
    }
    const [holdings, summaryResult] = await Promise.all([ d
