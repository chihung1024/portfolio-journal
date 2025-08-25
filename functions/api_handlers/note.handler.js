// =========================================================================================
// == 筆記 Action 處理模組 (note.handler.js) v2.1 - Staging-Ready
// =========================================================================================

const { d1Client } = require('../d1.client');
const { stockNoteSchema } = require('../schemas');
const { stageChange } = require('./staging.handler'); // 導入暫存區處理器

// ========================= 【核心修改 - 開始】 =========================

/**
 * 【新增】獲取合併了暫存狀態的筆記列表
 */
exports.getNotesWithStaging = async (uid, res) => {
    const [committedNotes, stagedChanges] = await Promise.all([
        d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid]),
        d1Client.query(`SELECT * FROM staged_changes WHERE uid = ? AND entity_type = 'note' ORDER BY created_at ASC`, [uid])
    ]);

    // Note uses symbol as its ID, so we map by symbol.
    const noteMap = new Map(committedNotes.map(n => [n.symbol, { ...n, status: 'COMMITTED' }]));

    for (const change of stagedChanges) {
        const payload = JSON.parse(change.payload);
        const entityId = change.entity_id; // entity_id is the symbol for notes

        // For notes, we only have UPDATE operation which acts as an "upsert".
        if (change.operation_type === 'UPDATE') {
            const existing = noteMap.get(entityId);
            if (existing) {
                Object.assign(existing, payload, { status: 'STAGED_UPDATE', changeId: change.id });
            } else {
                // If it doesn't exist, it's effectively a new staged note.
                noteMap.set(entityId, { ...payload, status: 'STAGED_UPDATE', changeId: change.id });
            }
        }
    }
    
    const finalNotes = Array.from(noteMap.values());
    return res.status(200).send({ success: true, data: { notes: finalNotes, hasStagedChanges: stagedChanges.length > 0 } });
};


/**
 * 將「儲存筆記」的請求轉發至暫存區
 */
exports.saveStockNote = async (uid, data, res) => {
    const noteData = stockNoteSchema.parse(data);
    // 筆記的儲存是 "upsert" (update or insert) 邏輯，在暫存區中我們統一視為 UPDATE
    return await stageChange(uid, { op: 'UPDATE', entity: 'note', payload: noteData }, res);
};

// ========================= 【核心修改 - 結束】 =========================
