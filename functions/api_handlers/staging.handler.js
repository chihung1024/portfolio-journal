// =========================================================================================
// == [新增檔案] 暫存區 API 處理模組 (staging.handler.js)
// == 職責：處理所有與暫存區相關的 API Action，實現暫存、讀取、提交與還原功能
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const schemas = require('../schemas');

// 定義暫存變更的操作類型
const changeOperationSchema = z.object({
    op: z.enum(['CREATE', 'UPDATE', 'DELETE']),
    entity: z.enum(['transaction', 'split', 'dividend']), // 可擴展
    payload: z.any()
});


/**
 * 1. Stage Change API: 將單一操作意圖寫入暫存區
 */
exports.stageChange = async (uid, data, res) => {
    const { op, entity, payload } = changeOperationSchema.parse(data);

    // 根據實體類型選擇對應的 schema 進行驗證
    let validatedPayload;
    let entityId = null;

    switch (entity) {
        case 'transaction':
            if (op === 'CREATE') {
                validatedPayload = schemas.transactionSchema.parse(payload);
            } else if (op === 'UPDATE') {
                validatedPayload = schemas.transactionSchema.extend({ id: z.string().uuid() }).parse(payload);
                entityId = validatedPayload.id;
            } else { // DELETE
                validatedPayload = z.object({ id: z.string().uuid() }).parse(payload);
                entityId = validatedPayload.id;
            }
            break;
        // 未來可在此處增加對 split, dividend 的處理
        default:
            return res.status(400).send({ success: false, message: `不支援的實體類型: ${entity}` });
    }

    const changeId = uuidv4();
    await d1Client.query(
        `INSERT INTO staged_changes (id, uid, entity_type, operation_type, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?)`,
        [changeId, uid, entity, op, entityId, JSON.stringify(validatedPayload)]
    );

    return res.status(200).send({ success: true, message: '變更已成功暫存。', changeId });
};


/**
 * 2. Get Merged View API: 獲取融合了暫存區數據的統一視圖
 */
exports.getTransactionsWithStaging = async (uid, res) => {
    const [committedTxs, stagedChanges] = await Promise.all([
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND entity_type = 'transaction' ORDER BY created_at ASC`, [uid])
    ]);

    // 以已確認的交易為基礎，建立一個可以快速查找的 Map
    const txMap = new Map(committedTxs.map(tx => [tx.id, { ...tx, status: 'COMMITTED' }]));

    // 在記憶體中「預演」暫存區的變更
    stagedChanges.forEach(change => {
        const payload = JSON.parse(change.payload);
        switch (change.operation_type) {
            case 'CREATE':
                // 為 CREATE 操作賦予一個臨時 ID，以便前端可以 key
                txMap.set(change.id, { ...payload, id: change.id, status: 'STAGED_CREATE' });
                break;
            case 'UPDATE':
                if (txMap.has(payload.id)) {
                    // 如果更新的是一個已確認的項目
                    txMap.set(payload.id, { ...txMap.get(payload.id), ...payload, status: 'STAGED_UPDATE' });
                } else {
                    // 如果更新的是一個暫存的 CREATE 項目
                    const stagedCreate = txMap.get(payload.id); // 這裡的 id 會是 change.id
                    if (stagedCreate && stagedCreate.status === 'STAGED_CREATE') {
                         txMap.set(payload.id, { ...stagedCreate, ...payload });
                    }
                }
                break;
            case 'DELETE':
                if (txMap.has(payload.id)) {
                    // 如果刪除的是一個已確認的項目，標記它
                    txMap.get(payload.id).status = 'STAGED_DELETE';
                } else {
                    // 如果刪除的是一個暫存的 CREATE 項目，直接從 Map 中移除
                     txMap.delete(payload.id);
                }
                break;
        }
    });

    // 將 Map 轉回陣列並排序
    const mergedTxs = Array.from(txMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.status(200).send({ success: true, data: { transactions: mergedTxs, hasStagedChanges: stagedChanges.length > 0 } });
};


/**
 * 3. Commit API: 提交所有暫存變更並觸發重算
 */
exports.commitAllChanges = async (uid, res) => {
    const pendingChanges = await d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND status = 'PENDING' ORDER BY created_at ASC`, [uid]);

    if (pendingChanges.length === 0) {
        return res.status(200).send({ success: false, message: '沒有待處理的變更。' });
    }

    const batchId = uuidv4();

    // 步驟一：將所有待辦事項標記為處理中
    const pendingIds = pendingChanges.map(c => c.id);
    const placeholders = pendingIds.map(() => '?').join(',');
    await d1Client.query(`UPDATE staged_changes SET status = 'COMMITTING', batch_id = ? WHERE id IN (${placeholders})`, [batchId, ...pendingIds]);

    // 步驟二：預驗證 (此處僅做 schema 驗證，未來可擴充)
    try {
        pendingChanges.forEach(change => {
            const payload = JSON.parse(change.payload);
            if (change.entity_type === 'transaction') {
                if (change.operation_type === 'CREATE') schemas.transactionSchema.parse(payload);
                if (change.operation_type === 'UPDATE') schemas.transactionSchema.extend({ id: z.string().uuid() }).parse(payload);
                if (change.operation_type === 'DELETE') z.object({ id: z.string().uuid() }).parse(payload);
            }
             // 可擴充對 split, dividend 的驗證
        });
    } catch (error) {
        // 驗證失敗，將狀態標記為 FAILED 並回傳
        await d1Client.query(`UPDATE staged_changes SET status = 'FAILED', error_message = ? WHERE batch_id = ?`, [error.message, batchId]);
        return res.status(400).send({ success: false, message: '提交的變更中有無效數據。', error: error.message });
    }

    // 步驟三：資料庫原子性寫入
    const dbOperations = [];
    let earliestChangeDate = new Date().toISOString();

    pendingChanges.forEach(change => {
        const payload = JSON.parse(change.payload);
        const date = payload.date || new Date().toISOString();
        if (date < earliestChangeDate) {
            earliestChangeDate = date;
        }

        switch (`${change.entity_type}:${change.operation_type}`) {
            case 'transaction:CREATE':
                dbOperations.push({
                    sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    params: [uuidv4(), uid, payload.date, payload.symbol, payload.type, payload.quantity, payload.price, payload.currency, payload.totalCost, payload.exchangeRate]
                });
                break;
            case 'transaction:UPDATE':
                dbOperations.push({
                    sql: `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
                    params: [payload.date, payload.symbol, payload.type, payload.quantity, payload.price, payload.currency, payload.totalCost, payload.exchangeRate, payload.id, uid]
                });
                break;
            case 'transaction:DELETE':
                 dbOperations.push({ sql: 'DELETE FROM transactions WHERE id = ? AND uid = ?', params: [payload.id, uid] });
                 // 確保連帶刪除群組歸屬
                 dbOperations.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE transaction_id = ? AND uid = ?', params: [payload.id, uid] });
                break;
        }
    });

    // 在同一個 batch 中刪除已處理的暫存紀錄
    dbOperations.push({ sql: `DELETE FROM staged_changes WHERE batch_id = ?`, params: [batchId] });

    try {
        await d1Client.batch(dbOperations);
    } catch (dbError) {
        await d1Client.query(`UPDATE staged_changes SET status = 'FAILED', error_message = ? WHERE batch_id = ?`, [dbError.message, batchId]);
        return res.status(500).send({ success: false, message: '資料庫寫入失敗。', error: dbError.message });
    }
    
    // 步驟四 & 五：同步觸發增量重算
    try {
        await performRecalculation(uid, earliestChangeDate, false);
    } catch (recalcError) {
        // 這是最糟情況：資料庫已更新，但計算失敗。需要手動介入。
        // 此時暫存紀錄已刪除，但我們可以透過日誌中的 batch_id 追蹤。
        console.error(`[CRITICAL] UID ${uid}, BatchID ${batchId}: 資料庫提交成功，但後續重算失敗! Error: ${recalcError.message}`);
        return res.status(500).send({ success: false, message: `資料庫已更新，但績效計算過程中發生錯誤。請聯繫管理員。 Batch ID: ${batchId}` });
    }

    // 步驟六：回傳最終結果
    const [holdings, summaryResult] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all'])
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
        data: { holdings, summary: summary_data, history: portfolioHistory, twrHistory, netProfitHistory, benchmarkHistory }
    });
};


/**
 * 4. Revert API: 捨棄單筆暫存變更
 */
exports.revertStagedChange = async (uid, data, res) => {
    const { changeId } = z.object({ changeId: z.string().uuid() }).parse(data);

    await d1Client.query(`DELETE FROM staged_changes WHERE id = ? AND uid = ?`, [changeId, uid]);

    return res.status(200).send({ success: true, message: '變更已捨棄。' });
};

/**
 * [新增] 5. Health Check API: 監控系統健康狀態
 */
exports.getSystemHealth = async (uid, res) => {
    const snapshotResult = await d1Client.query('SELECT MAX(snapshot_date) as last_snapshot_date FROM portfolio_snapshots WHERE uid = ?', [uid]);
    const lastSnapshotDate = snapshotResult[0]?.last_snapshot_date || null;
    return res.status(200).send({ success: true, data: { lastSnapshotDate } });
};
