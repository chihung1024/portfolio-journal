// =========================================================================================
// == 暫存區 API 處理模組 (staging.handler.js) v3.1 - 全面暫存 (修正版)
// == 職責：處理所有實體的暫存、提交、合併狀態等核心邏輯
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const schemas = require('../schemas');
const { populateSettlementFxRate } = require('./transaction.handler');

/**
 * 將一筆變更操作加入到後端暫存區資料庫 (已擴展)
 */
exports.stageChange = async (uid, data, res, isBatch = false) => {
    const { op, entity, payload } = schemas.stagedChangeSchema.parse(data);
    let validatedPayload;
    let entityId = payload.id || null;

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
        case 'dividend:CREATE':
        case 'dividend:UPDATE':
            validatedPayload = schemas.userDividendSchema.parse(payload);
            if (!entityId) { entityId = uuidv4(); validatedPayload.id = entityId; }
            break;
        case 'dividend:DELETE':
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
        case 'note:UPDATE':
            validatedPayload = schemas.stockNoteSchema.parse(payload);
            entityId = payload.symbol;
            break;
        case 'group:CREATE':
        case 'group:UPDATE':
            validatedPayload = schemas.groupSchema.parse(payload);
            if (!entityId) { entityId = uuidv4(); validatedPayload.id = entityId; }
            break;
        case 'group:DELETE':
            validatedPayload = z.object({ id: z.string().uuid() }).parse(payload);
            break;
        // ========================= 【核心修正 - 開始】 =========================
        case 'group_membership:UPDATE':
            validatedPayload = z.object({ transactionId: z.string(), groupIds: z.array(z.string()) }).parse(payload);
            entityId = payload.transactionId;
            break;
        // ========================= 【核心修正 - 結束】 =========================
        default:
            if (!isBatch) return res.status(400).send({ success: false, message: `不支援的操作: ${entity}:${op}` });
            else throw new Error(`不支援的操作: ${entity}:${op}`);
    }

    const changeId = uuidv4();
    await d1Client.query(
        `INSERT INTO staged_changes (id, uid, entity_type, operation_type, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?)`,
        [changeId, uid, entity, op, entityId, JSON.stringify(validatedPayload)]
    );

    if (!isBatch) {
        return res.status(200).send({ success: true, message: '變更已成功暫存。', changeId, entityId });
    }
};

/**
 * 提交指定使用者的所有暫存變更 (已擴展)
 */
exports.commitAllChanges = async (uid, res) => {
    const pendingChanges = await d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? ORDER BY created_at ASC`, [uid]);
    if (pendingChanges.length === 0) return res.status(200).send({ success: true, message: '沒有待處理的變更。' });

    const dbOperations = [];
    let earliestChangeDate = new Date().toISOString();
    let needsRecalculation = false;

    const processedChanges = await Promise.all(pendingChanges.map(async (change) => {
        let payload = JSON.parse(change.payload);
        if (change.entity_type === 'transaction' && (change.operation_type === 'CREATE' || change.operation_type === 'UPDATE')) {
            payload = await populateSettlementFxRate(payload);
        }
        return { ...change, payload };
    }));

    for (const change of processedChanges) {
        const { payload, entity_type: entity, operation_type: op, entity_id: entityId } = change;
        
        if (payload.date && payload.date < earliestChangeDate) earliestChangeDate = payload.date;

        switch (`${entity}:${op}`) {
            case 'transaction:CREATE':
            case 'transaction:UPDATE':
            case 'transaction:DELETE':
            case 'dividend:CREATE':
            case 'dividend:UPDATE':
            case 'dividend:DELETE':
            case 'split:CREATE':
            case 'split:DELETE':
                needsRecalculation = true;
                break;
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
            case 'dividend:CREATE':
            case 'dividend:UPDATE':
                dbOperations.push({ sql: 'DELETE FROM user_pending_dividends WHERE uid = ? AND symbol = ? AND ex_dividend_date = ?', params: [uid, payload.symbol, payload.ex_dividend_date] });
                dbOperations.push({ sql: `INSERT OR REPLACE INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`, params: [entityId, uid, payload.symbol, payload.ex_dividend_date, payload.pay_date, payload.amount_per_share, payload.quantity_at_ex_date, payload.total_amount, payload.tax_rate, payload.currency, payload.notes] });
                break;
            case 'dividend:DELETE':
                dbOperations.push({ sql: 'DELETE FROM user_dividends WHERE id = ? AND uid = ?', params: [entityId, uid] });
                break;
            case 'split:CREATE':
                dbOperations.push({ sql: `INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`, params: [entityId, uid, payload.date, payload.symbol, payload.ratio] });
                break;
            case 'split:DELETE':
                dbOperations.push({ sql: 'DELETE FROM splits WHERE id = ? AND uid = ?', params: [entityId, uid] });
                break;
            case 'note:UPDATE':
                dbOperations.push({ sql: `INSERT INTO user_stock_notes (id, uid, symbol, target_price, stop_loss_price, notes, last_updated) VALUES ((SELECT id FROM user_stock_notes WHERE uid = ? AND symbol = ?), ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET target_price=excluded.target_price, stop_loss_price=excluded.stop_loss_price, notes=excluded.notes, last_updated=excluded.last_updated`, params: [uid, payload.symbol, uuidv4(), uid, payload.symbol, payload.target_price, payload.stop_loss_price, payload.notes, new Date().toISOString()] });
                break;
            case 'group:CREATE':
            case 'group:UPDATE':
                dbOperations.push({ sql: `INSERT INTO groups (id, uid, name, description, is_dirty) VALUES (?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, is_dirty=1`, params: [entityId, uid, payload.name, payload.description] });
                dbOperations.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND group_id = ?', params: [uid, entityId] });
                if (payload.transactionIds && payload.transactionIds.length > 0) {
                    payload.transactionIds.forEach(txId => dbOperations.push({ sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)', params: [uid, entityId, txId] }));
                }
                break;
            case 'group:DELETE':
                dbOperations.push({ sql: 'DELETE FROM group_cache WHERE group_id = ? AND uid = ?', params: [entityId, uid] });
                dbOperations.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE group_id = ? AND uid = ?', params: [entityId, uid] });
                dbOperations.push({ sql: 'DELETE FROM groups WHERE id = ? AND uid = ?', params: [entityId, uid] });
                break;
            // ========================= 【核心修正 - 開始】 =========================
            case 'group_membership:UPDATE':
                const { transactionId, groupIds } = payload;
                dbOperations.push({ sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?', params: [uid, transactionId] });
                if (groupIds && groupIds.length > 0) {
                    groupIds.forEach(gid => dbOperations.push({ sql: 'INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)', params: [uid, gid, transactionId] }));
                }
                break;
            // ========================= 【核心修正 - 結束】 =========================
        }
    }
    
    if(dbOperations.length > 0) await d1Client.batch(dbOperations);

    if (needsRecalculation) {
        try { await performRecalculation(uid, earliestChangeDate, false); } 
        catch (recalcError) { return res.status(500).send({ success: false, message: `資料庫已更新，但績效計算過程中發生錯誤。請聯繫管理員。` }); }
    }
    
    const pendingIds = pendingChanges.map(c => c.id);
    if(pendingIds.length > 0) {
        const placeholders = pendingIds.map(() => '?').join(',');
        await d1Client.query(`DELETE FROM staged_changes WHERE id IN (${placeholders})`, pendingIds);
    }

    return res.status(200).send({ success: true, message: '所有變更已成功提交並計算完畢。' });
};

async function getEntitiesWithStaging(uid, entityType, baseQuery) {
    const [committedEntities, stagedChanges] = await Promise.all([
        d1Client.query(baseQuery, [uid]),
        d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND entity_type = ? ORDER BY created_at ASC`, [uid, entityType])
    ]);
    const entityMap = new Map(committedEntities.map(e => [e.id, { ...e, status: 'COMMITTED' }]));
    for (const change of stagedChanges) {
        const payload = JSON.parse(change.payload);
        const entityId = change.entity_id;
        if (change.operation_type === 'CREATE') {
            entityMap.set(entityId, { ...payload, id: entityId, status: 'STAGED_CREATE', changeId: change.id });
        } else if (change.operation_type === 'UPDATE') {
            const existing = entityMap.get(entityId);
            if (existing) Object.assign(existing, payload, { status: 'STAGED_UPDATE', changeId: change.id });
        } else if (change.operation_type === 'DELETE') {
            const existing = entityMap.get(entityId);
            if (existing) {
                if (existing.status === 'STAGED_CREATE') entityMap.delete(entityId);
                else { existing.status = 'STAGED_DELETE'; existing.changeId = change.id; }
            }
        }
    }
    return { entities: Array.from(entityMap.values()), hasStagedChanges: stagedChanges.length > 0 };
}

exports.getTransactionsWithStaging = async (uid, res) => {
    const { entities, hasStagedChanges } = await getEntitiesWithStaging(uid, 'transaction', 'SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC');
    return res.status(200).send({ success: true, data: { transactions: entities.sort((a, b) => new Date(b.date) - new Date(a.date)), hasStagedChanges } });
};

exports.getSplitsWithStaging = async (uid, res) => {
    const { entities, hasStagedChanges } = await getEntitiesWithStaging(uid, 'split', 'SELECT * FROM splits WHERE uid = ? ORDER BY date DESC');
    return res.status(200).send({ success: true, data: { splits: entities.sort((a, b) => new Date(b.date) - new Date(a.date)), hasStagedChanges } });
};

exports.getDividendsWithStaging = async (uid, res) => {
    const { entities, hasStagedChanges } = await getEntitiesWithStaging(uid, 'dividend', 'SELECT * FROM user_dividends WHERE uid = ? ORDER BY pay_date DESC');
    return res.status(200).send({ success: true, data: { dividends: entities.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date)), hasStagedChanges } });
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