// =========================================================================================
// == [最終修正檔案] 暫存區 API 處理模組 (staging.handler.js) v1.7 - 終局一致性修復
// == 職責：處理所有與暫存區相關的 API Action，確保回傳最終一致的狀態
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const schemas = require('../schemas');

const changeOperationSchema = z.object({
    op: z.enum(['CREATE', 'UPDATE', 'DELETE']),
    entity: z.enum(['transaction', 'split', 'dividend', 'group_membership']),
    payload: z.any()
});

exports.stageChange = async (uid, data, res) => {
    const { op, entity, payload } = changeOperationSchema.parse(data);
    let validatedPayload;
    let entityId = null;
    switch (`${entity}:${op}`) {
        case 'transaction:CREATE': validatedPayload = schemas.transactionSchema.parse(payload); break;
        case 'transaction:UPDATE': validatedPayload = schemas.transactionSchema.extend({ id: z.string().uuid() }).parse(payload); entityId = validatedPayload.id; break;
        case 'transaction:DELETE': validatedPayload = z.object({ id: z.string().uuid() }).parse(payload); entityId = validatedPayload.id; break;
        case 'group_membership:UPDATE': validatedPayload = z.object({ transactionId: z.string().uuid(), groupIds: z.array(z.string()) }).parse(payload); entityId = validatedPayload.transactionId; break;
        case 'split:CREATE': validatedPayload = schemas.splitSchema.parse(payload); break;
        case 'split:DELETE': validatedPayload = z.object({ id: z.string().uuid() }).parse(payload); entityId = validatedPayload.id; break;
        case 'dividend:CREATE': case 'dividend:UPDATE': validatedPayload = schemas.userDividendSchema.parse(payload); entityId = payload.id || null; break;
        case 'dividend:DELETE': validatedPayload = z.object({ id: z.string().uuid() }).parse(payload); entityId = validatedPayload.id; break;
        default: return res.status(400).send({ success: false, message: `不支援的操作: ${entity}:${op}` });
    }
    const changeId = payload.id || uuidv4(); // Use payload id if exists
    await d1Client.query( `INSERT INTO staged_changes (id, uid, entity_type, operation_type, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?)`, [changeId, uid, entity, op, entityId, JSON.stringify(validatedPayload)]);
    return res.status(200).send({ success: true, message: '變更已成功暫存。', changeId });
};

exports.getTransactionsWithStaging = async (uid, data, res) => {
    try {
        const [committedTxs, stagedChanges] = await Promise.all([ 
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]), 
            d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND entity_type = 'transaction' AND status = 'PENDING' ORDER BY created_at ASC`, [uid])
        ]);
        const txMap = new Map(committedTxs.map(tx => [tx.id, { ...tx, status: 'COMMITTED' }]));
        for (const change of stagedChanges) {
            try {
                const payload = JSON.parse(change.payload); 
                const entityId = change.id;
                if (!entityId) continue;

                if (change.operation_type === 'CREATE') { 
                    txMap.set(entityId, { ...payload, id: entityId, status: 'STAGED_CREATE' }); 
                } else if (change.operation_type === 'UPDATE') {
                    const existingTx = txMap.get(payload.id); 
                    if (existingTx) { 
                        txMap.set(payload.id, { ...existingTx, ...payload, status: 'STAGED_UPDATE' }); 
                    }
                } else if (change.operation_type === 'DELETE') {
                    const existingTx = txMap.get(payload.id);
                    if (existingTx) {
                        if (existingTx.status === 'STAGED_CREATE') { 
                            txMap.delete(payload.id); 
                        } else { 
                            existingTx.status = 'STAGED_DELETE'; 
                        }
                    }
                }
            } catch (e) { console.error(`Error processing change ${change.id}:`, e); }
        }
        const mergedTxs = Array.from(txMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
        return res.status(200).send({ success: true, data: { transactions: mergedTxs, hasStagedChanges: stagedChanges.length > 0 } });
    } catch (error) {
        console.error("Critical error in getTransactionsWithStaging:", error);
        return res.status(500).send({ success: false, message: `伺服器處理交易列表時發生嚴重錯誤: ${error.message}` });
    }
};

exports.commitAllChanges = async (uid, data, res) => {
    const pendingChanges = await d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND status = 'PENDING' ORDER BY created_at ASC`, [uid]);
    if (pendingChanges.length === 0) {
        // 即便沒有變更，也回傳一次最新的狀態，確保前端同步
        const [holdings, summaryResult, transactions, splits, stockNotes, pendingDividends, confirmedDividends] = await Promise.all([ d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']), d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']), d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]), d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]), d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid]), d1Client.query('SELECT * FROM user_pending_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid]), d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY pay_date DESC', [uid]) ]);
        const summaryRow = summaryResult[0] || {}; const summary_data = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {}; const portfolioHistory = summaryRow.history ? JSON.parse(summaryRow.history) : {}; const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {}; const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {}; const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
        return res.status(200).send({ success: true, message: '沒有待處理的變更。', data: { holdings, summary: summary_data, history: portfolioHistory, twrHistory, netProfitHistory, benchmarkHistory, transactions, splits, stockNotes, pendingDividends, confirmedDividends } });
    }

    const batchId = uuidv4();
    const pendingIds = pendingChanges.map(c => c.id);
    await d1Client.batch([{ sql: `UPDATE staged_changes SET status = 'COMMITTING', batch_id = ? WHERE id IN (${pendingIds.map(()=>'?').join(',')})`, params: [batchId, ...pendingIds] }]);
    
    try {
        pendingChanges.forEach(change => {
            const payload = JSON.parse(change.payload);
            const { entity_type: entity, operation_type: op } = change;
            switch (`${entity}:${op}`) {
                case 'transaction:CREATE': schemas.transactionSchema.parse(payload); break;
                case 'transaction:UPDATE': schemas.transactionSchema.extend({ id: z.string().uuid() }).parse(payload); break;
                case 'transaction:DELETE': z.object({ id: z.string().uuid() }).parse(payload); break;
                case 'group_membership:UPDATE': schemas.groupMembershipSchema.parse(payload); break;
                case 'split:CREATE': schemas.splitSchema.parse(payload); break;
                case 'split:DELETE': z.object({ id: z.string().uuid() }).parse(payload); break;
                case 'dividend:CREATE': case 'dividend:UPDATE': schemas.userDividendSchema.parse(payload); break;
                case 'dividend:DELETE': z.object({ id: z.string().uuid() }).parse(payload); break;
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
        const entityId = change.id; // Always use change.id as the primary key
        
        switch (`${change.entity_type}:${change.operation_type}`) {
            case 'transaction:CREATE':
                dbOperations.push({ sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [entityId, uid, payload.date, payload.symbol, payload.type, payload.quantity, payload.price, payload.currency, payload.totalCost, payload.exchangeRate] });
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
                payload.groupIds.forEach(groupId => {
                    dbOperations.push({ sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)', params: [uid, groupId, payload.transactionId] });
                });
                break;
        }
    });
    
    dbOperations.push({ sql: `DELETE FROM staged_changes WHERE batch_id = ?`, params: [batchId] });
    
    try { 
        await d1Client.batch(dbOperations); 
    } catch (dbError) { 
        await d1Client.query(`UPDATE staged_changes SET status = 'PENDING', batch_id = NULL WHERE batch_id = ?`, [batchId]);
        return res.status(500).send({ success: false, message: '資料庫寫入失敗，您的變更已還原。', error: dbError.message });
    }
    
    try { 
        await performRecalculation(uid, earliestChangeDate, false); 
        
        const [holdings, summaryResult, transactions, splits, stockNotes, pendingDividends, confirmedDividends] = await Promise.all([
            d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM user_pending_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid]),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY pay_date DESC', [uid])
        ]);

        const summaryRow = summaryResult[0] || {}; 
        const summary_data = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {}; 
        const portfolioHistory = summaryRow.history ? JSON.parse(summaryRow.history) : {}; 
        const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {}; 
        const netProfitHistory = summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {}; 
        const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
    
        return res.status(200).send({ 
            success: true, 
            message: '所有變更已成功提交並計算完畢。', 
            data: { 
                holdings, 
                summary: summary_data, 
                history: portfolioHistory, 
                twrHistory, 
                netProfitHistory, 
                benchmarkHistory,
                transactions,
                splits,
                stockNotes,
                pendingDividends,
                confirmedDividends
            } 
        });

    } catch (recalcError) { 
        console.error(`[CRITICAL] UID ${uid}, BatchID ${batchId}: DB commit OK, but recalc/fetch failed! Error: ${recalcError.message}`); 
        return res.status(500).send({ success: false, message: `資料庫已更新，但績效計算或最終資料獲取過程中發生錯誤。請聯繫管理員。 Batch ID: ${batchId}` }); 
    }
};

exports.revertStagedChange = async (uid, data, res) => {
    const { changeId } = z.object({ changeId: z.string() }).parse(data);
    await d1Client.query(`DELETE FROM staged_changes WHERE id = ? AND uid = ?`, [changeId, uid]);
    return res.status(200).send({ success: true, message: '變更已捨棄。' });
};

exports.getSystemHealth = async (uid, data, res) => {
    const snapshotResult = await d1Client.query('SELECT MAX(snapshot_date) as last_snapshot_date FROM portfolio_snapshots WHERE uid = ?', [uid]);
    const lastSnapshotDate = snapshotResult[0]?.last_snapshot_date || null;
    return res.status(200).send({ success: true, data: { lastSnapshotDate } });
};
