// =========================================================================================
// == 暫存區 API 處理模組 (staging.handler.js) v3.1 - Global Staging Engine
// == 職責：處理所有與暫存區相關的 API Action，實現全局 CUD 的核心邏輯
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const schemas = require('../schemas');
const { populateSettlementFxRate } = require('./transaction.handler');

/**
 * 將一筆變更操作加入到後端暫存區資料庫 (已擴充)
 */
exports.stageChange = async (uid, data, res) => {
    const { op, entity, payload } = schemas.stagedChangeSchema.parse(data);
    let validatedPayload;
    let entityId = payload.id || null;

    // 根據實體類型和操作，進行精確的 payload 驗證
    switch (`${entity}:${op}`) {
        case 'transaction:CREATE':
            validatedPayload = schemas.transactionSchema.parse(payload);
            entityId = uuidv4();
            validatedPayload.id = entityId;
            break;
        case 'transaction:UPDATE':
            validatedPayload = schemas.transactionSchema.extend({ id: z.string().uuid() }).parse(payload);
            break;
        case 'transaction:DELETE':
            validatedPayload = z.object({ id: z.string().uuid() }).parse(payload);
            break;
        
        case 'split:CREATE':
            validatedPayload = schemas.splitSchema.parse(payload);
            entityId = uuidv4();
            validatedPayload.id = entityId;
            break;
        case 'split:DELETE':
            validatedPayload = z.object({ id: z.string().uuid() }).parse(payload);
            break;
        
        case 'dividend:CREATE':
        case 'dividend:UPDATE':
            validatedPayload = schemas.userDividendSchema.parse(payload);
            if (op === 'CREATE' && !validatedPayload.id) {
                entityId = uuidv4();
                validatedPayload.id = entityId;
            }
            break;
        case 'dividend:DELETE':
            validatedPayload = z.object({ dividendId: z.string().uuid() }).parse(payload);
            entityId = validatedPayload.dividendId;
            break;

        default:
            validatedPayload = payload;
            if (op === 'CREATE' && !entityId) {
                entityId = uuidv4();
                validatedPayload.id = entityId;
            }
            break;
    }

    const changeId = uuidv4();
    await d1Client.query(
        `INSERT INTO staged_changes (id, uid, entity_type, operation_type, entity_id, payload, status) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
        [changeId, uid, entity, op, entityId, JSON.stringify(validatedPayload)]
    );

    return res.status(200).send({ success: true, message: '變更已成功暫存。', changeId, entityId });
};

/**
 * 【重構】提交指定使用者的所有暫存變更 (核心事務處理器)
 */
exports.commitAllChanges = async (uid, res) => {
    const pendingChanges = await d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND status = 'PENDING' ORDER BY created_at ASC`, [uid]);
    
    // 即使沒有變更，也執行一次重算並回傳最新數據，確保資料同步
    if (pendingChanges.length === 0) {
        await performRecalculation(uid, null, false);
        const [holdings, summaryResult, transactions, splits, stockNotes] = await Promise.all([
            d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
            d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
        ]);
        const summaryRow = summaryResult[0] || {};
        return res.status(200).send({
            success: true, message: '沒有待處理的變更，已回傳最新數據。',
            data: {
                holdings,
                summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
                history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
                twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
                netProfitHistory: summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {},
                benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
                transactions, splits, stockNotes
            }
        });
    }

    const dbOperations = [];
    let earliestChangeDate = new Date().toISOString();

    const processedChanges = await Promise.all(pendingChanges.map(async (change) => {
        let payload = JSON.parse(change.payload);
        if (change.entity_type === 'transaction' && (change.operation_type === 'CREATE' || change.operation_type === 'UPDATE')) {
            payload = await populateSettlementFxRate(payload);
        }
        return { ...change, payload };
    }));

    for (const change of processedChanges) {
        const { payload, entity_type: entity, operation_type: op, entity_id: entityId } = change;
        const date = payload.date || new Date().toISOString();
        if (date < earliestChangeDate) earliestChangeDate = date;

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
    
    try {
        if (dbOperations.length > 0) await d1Client.batch(dbOperations);
    } catch (dbError) {
        console.error(`[Commit Error] UID ${uid}: D1 Batch failed.`, dbError);
        return res.status(500).send({ success: false, message: '資料庫寫入失敗，您的變更已還原。', error: dbError.message });
    }
    
    await performRecalculation(uid, earliestChangeDate, false);
    
    const pendingIds = pendingChanges.map(c => c.id);
    if (pendingIds.length > 0) {
        const placeholders = pendingIds.map(() => '?').join(',');
        await d1Client.query(`DELETE FROM staged_changes WHERE id IN (${placeholders})`, pendingIds);
    }

    const [holdings, summaryResult, transactions, splits, stockNotes] = await Promise.all([
        d1Client.query('SELECT * FROM holdings WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, 'all']),
        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
        d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
    ]);
    const summaryRow = summaryResult[0] || {};
    
    return res.status(200).send({
        success: true, message: '所有變更已成功提交並計算完畢。',
        data: {
            holdings,
            summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
            history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
            twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
            netProfitHistory: summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {},
            benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
            transactions, splits, stockNotes
        }
    });
};

exports.revertStagedChange = async (uid, data, res) => {
    const { changeId } = z.object({ changeId: z.string() }).parse(data);
    await d1Client.query(`DELETE FROM staged_changes WHERE id = ? AND uid = ?`, [changeId, uid]);
    return res.status(200).send({ success: true, message: '變更已捨棄。' });
};

exports.discardAllChanges = async (uid, res) => {
    await d1Client.query(`DELETE FROM staged_changes WHERE uid = ?`, [uid]);
    return res.status(200).send({ success: true, message: '所有暫存變更已捨棄。' });
};

exports.getTransactionsWithStaging = async (uid, res) => {
    const { data } = await exports.getAllEntitiesWithStaging(uid);
    return res.status(200).send({
        success: true,
        data: {
            transactions: data.transactions,
            hasStagedChanges: data.hasStagedChanges
        }
    });
};

/**
 * 【新增並實作】統一 API: 獲取所有核心實體並混合暫存狀態
 */
exports.getAllEntitiesWithStaging = async (uid, res) => {
    try {
        const [committedTxs, committedSplits, committedDividends, stagedChanges] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? ORDER BY created_at ASC`, [uid])
        ]);

        const txMap = new Map(committedTxs.map(tx => [tx.id, { ...tx, status: 'COMMITTED' }]));
        const splitMap = new Map(committedSplits.map(s => [s.id, { ...s, status: 'COMMITTED' }]));
        const dividendMap = new Map(committedDividends.map(d => [d.id, { ...d, status: 'COMMITTED' }]));

        for (const change of stagedChanges) {
            const payload = JSON.parse(change.payload);
            const { entity_type: entity, operation_type: op, entity_id: entityId, id: changeId } = change;
            
            let targetMap;
            switch(entity) {
                case 'transaction': targetMap = txMap; break;
                case 'split': targetMap = splitMap; break;
                case 'dividend': targetMap = dividendMap; break;
                default: continue;
            }

            if (op === 'CREATE') {
                targetMap.set(entityId, { ...payload, id: entityId, status: 'STAGED_CREATE', changeId });
            } else if (op === 'UPDATE') {
                const existing = targetMap.get(entityId);
                if (existing) Object.assign(existing, payload, { status: 'STAGED_UPDATE', changeId });
            } else if (op === 'DELETE') {
                const existing = targetMap.get(entityId);
                if (existing) {
                    if (existing.status === 'STAGED_CREATE') {
                        targetMap.delete(entityId);
                    } else {
                        existing.status = 'STAGED_DELETE';
                        existing.changeId = changeId;
                    }
                }
            }
        }
        
        const mergedTxs = Array.from(txMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
        const mergedSplits = Array.from(splitMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
        const mergedDividends = Array.from(dividendMap.values()).sort((a, b) => new Date(b.pay_date || b.ex_dividend_date) - new Date(a.pay_date || a.ex_dividend_date));

        const responseData = {
            transactions: mergedTxs,
            splits: mergedSplits,
            dividends: mergedDividends,
            hasStagedChanges: stagedChanges.length > 0
        };

        // 如果是 res 物件存在，代表是正常的 API 呼叫
        if (res && typeof res.status === 'function') {
            return res.status(200).send({ success: true, data: responseData });
        }
        // 否則代表是內部呼叫 (例如從 getTransactionsWithStaging)
        return { data: responseData };

    } catch (error) {
        console.error("Error in getAllEntitiesWithStaging:", error);
        if (res && typeof res.status === 'function') {
            return res.status(500).send({ success: false, message: `伺服器處理列表時發生錯誤: ${error.message}` });
        }
        // 內部呼叫時，向上拋出錯誤
        throw error;
    }
};