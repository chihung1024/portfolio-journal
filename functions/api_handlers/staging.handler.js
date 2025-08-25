// =========================================================================================
// == 暫存區 API 處理模組 (staging.handler.js) v2.1 - 整合交割匯率
// == 職責：處理所有與暫存區相關的 API Action，實現非同步提交的核心邏輯
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const schemas = require('../schemas');
// ========================= 【核心修改 - 開始】 =========================
const { populateSettlementFxRate } = require('./transaction.handler');
// ========================= 【核心修改 - 結束】 =========================

/**
 * 將一筆變更操作加入到後端暫存區資料庫
 */
exports.stageChange = async (uid, data, res) => {
    // 根據前端傳來的操作類型和實體，進行對應的 payload 驗證
    const { op, entity, payload } = schemas.stagedChangeSchema.parse(data);
    let validatedPayload;
    let entityId = payload.id || null;

    switch (`${entity}:${op}`) {
        case 'transaction:CREATE':
            validatedPayload = schemas.transactionSchema.parse(payload);
            entityId = uuidv4(); // 為新的交易產生一個 UUID
            validatedPayload.id = entityId;
            break;
        case 'transaction:UPDATE':
            validatedPayload = schemas.transactionSchema.extend({ id: z.string().uuid() }).parse(payload);
            break;
        case 'transaction:DELETE':
            validatedPayload = z.object({ id: z.string().uuid() }).parse(payload);
            break;
        default:
            return res.status(400).send({ success: false, message: `不支援的操作: ${entity}:${op}` });
    }

    const changeId = uuidv4();
    await d1Client.query(
        `INSERT INTO staged_changes (id, uid, entity_type, operation_type, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?)`,
        [changeId, uid, entity, op, entityId, JSON.stringify(validatedPayload)]
    );

    return res.status(200).send({ success: true, message: '變更已成功暫存。', changeId, entityId });
};

/**
 * 獲取合併了暫存區狀態的交易列表
 */
exports.getTransactionsWithStaging = async (uid, res) => {
    try {
        const [committedTxs, stagedChanges] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND entity_type = 'transaction' ORDER BY created_at ASC`, [uid])
        ]);

        const txMap = new Map(committedTxs.map(tx => [tx.id, { ...tx, status: 'COMMITTED' }]));

        for (const change of stagedChanges) {
            const payload = JSON.parse(change.payload);
            const entityId = change.entity_id;

            if (change.operation_type === 'CREATE') {
                txMap.set(entityId, { ...payload, id: entityId, status: 'STAGED_CREATE', changeId: change.id });
            } else if (change.operation_type === 'UPDATE') {
                const existingTx = txMap.get(entityId);
                if (existingTx) {
                    Object.assign(existingTx, payload, { status: 'STAGED_UPDATE', changeId: change.id });
                }
            } else if (change.operation_type === 'DELETE') {
                const existingTx = txMap.get(entityId);
                if (existingTx) {
                    if (existingTx.status === 'STAGED_CREATE') {
                        txMap.delete(entityId);
                    } else {
                        existingTx.status = 'STAGED_DELETE';
                        existingTx.changeId = change.id;
                    }
                }
            }
        }
        
        const mergedTxs = Array.from(txMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.status(200).send({
            success: true,
            data: {
                transactions: mergedTxs,
                hasStagedChanges: stagedChanges.length > 0
            }
        });
    } catch (error) {
        console.error("Error in getTransactionsWithStaging:", error);
        return res.status(500).send({ success: false, message: `伺服器處理交易列表時發生錯誤: ${error.message}` });
    }
};

/**
 * 提交指定使用者的所有暫存變更
 */
exports.commitAllChanges = async (uid, res) => {
    const pendingChanges = await d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND status = 'PENDING' ORDER BY created_at ASC`, [uid]);
    if (pendingChanges.length === 0) {
        return res.status(200).send({ success: true, message: '沒有待處理的變更。' });
    }

    const dbOperations = [];
    let earliestChangeDate = new Date().toISOString();

    // ========================= 【核心修改 - 開始】 =========================
    // 步驟 1: 預處理 payload，填充預設匯率
    const processedChanges = await Promise.all(pendingChanges.map(async (change) => {
        let payload = JSON.parse(change.payload);
        if (change.entity_type === 'transaction' && (change.operation_type === 'CREATE' || change.operation_type === 'UPDATE')) {
            payload = await populateSettlementFxRate(payload);
        }
        return { ...change, payload }; // 返回包含豐富化 payload 的變更物件
    }));
    // ========================= 【核心修改 - 結束】 =========================

    // 步驟 2: 構建資料庫批次操作
    for (const change of processedChanges) { // 使用處理過的 changes
        const { payload, entity_type: entity, operation_type: op, entity_id: entityId } = change;
        
        const date = payload.date || new Date().toISOString();
        if (date < earliestChangeDate) {
            earliestChangeDate = date;
        }

        switch (`${entity}:${op}`) {
            case 'transaction:CREATE':
                dbOperations.push({ sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [entityId, uid, payload.date, payload.symbol, payload.type, payload.quantity, payload.price, payload.currency, payload.totalCost, payload.exchangeRate] });
                break;
            case 'transaction:UPDATE':
                dbOperations.push({ sql: `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`, params: [payload.date, payload.symbol, payload.type, payload.quantity, payload.price, payload.currency, payload.totalCost, payload.exchangeRate, entityId, uid] });
                break;
            case 'transaction:DELETE':
                dbOperations.push({ sql: 'DELETE FROM transactions WHERE id = ? AND uid = ?', params: [entityId, uid] });
                dbOperations.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE transaction_id = ? AND uid = ?', params: [entityId, uid] });
                break;
        }
    }
    
    // 步驟 3: 執行批次操作
    try {
        if(dbOperations.length > 0) await d1Client.batch(dbOperations);
    } catch (dbError) {
        console.error(`[Commit Error] UID ${uid}: D1 Batch failed.`, dbError);
        return res.status(500).send({ success: false, message: '資料庫寫入失敗，您的變更已還原。', error: dbError.message });
    }

    // 步驟 4: 執行重算
    try {
        await performRecalculation(uid, earliestChangeDate, false);
    } catch (recalcError) {
        console.error(`[CRITICAL] UID ${uid}: DB commit OK, but recalc failed!`, recalcError);
        return res.status(500).send({ success: false, message: `資料庫已更新，但績效計算過程中發生錯誤。請聯繫管理員。` });
    }
    
    // 步驟 5: 清除已處理的暫存變更
    const pendingIds = pendingChanges.map(c => c.id);
    if(pendingIds.length > 0) {
        const placeholders = pendingIds.map(() => '?').join(',');
        await d1Client.query(`DELETE FROM staged_changes WHERE id IN (${placeholders})`, pendingIds);
    }

    // 步驟 6: 獲取並回傳全新的、完整的投資組合數據
    const [holdings, summaryResult, transactions, splits, stockNotes] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
    ]);
    const summaryRow = summaryResult[0] || {};
    
    return res.status(200).send({
        success: true,
        message: '所有變更已成功提交並計算完畢。',
        data: {
            holdings,
            summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
            history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
            twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
            netProfitHistory: summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {},
            benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
            transactions,
            splits,
            stockNotes
        }
    });
};

/**
 * 捨棄單筆暫存變更
 */
exports.revertStagedChange = async (uid, data, res) => {
    const { changeId } = z.object({ changeId: z.string() }).parse(data);
    await d1Client.query(`DELETE FROM staged_changes WHERE id = ? AND uid = ?`, [changeId, uid]);
    return res.status(200).send({ success: true, message: '變更已捨棄。' });
};

/**
 * 捨棄所有暫存變更
 */
exports.discardAllChanges = async (uid, res) => {
    await d1Client.query(`DELETE FROM staged_changes WHERE uid = ?`, [uid]);
    return res.status(200).send({ success: true, message: '所有暫存變更已捨棄。' });
};