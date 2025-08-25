// =========================================================================================
// == 筆記 Action 處理模組 (note.handler.js)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');

/**
 * 儲存個股的筆記、目標價與停損價
 */
exports.saveStockNote = async (uid, data, res) => {
    const { symbol, target_price, stop_loss_price, notes } = data;

    const existing = await d1Client.query(
        'SELECT id FROM user_stock_notes WHERE uid = ? AND symbol = ?',
        [uid, symbol]
    );

    if (existing.length > 0) {
        await d1Client.query(
            'UPDATE user_stock_notes SET target_price = ?, stop_loss_price = ?, notes = ?, last_updated = ? WHERE id = ?',
            [target_price, stop_loss_price, notes, new Date().toISOString(), existing[0].id]
        );
    } else {
        await d1Client.query(
            'INSERT INTO user_stock_notes (id, uid, symbol, target_price, stop_loss_price, notes, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [uuidv4(), uid, symbol, target_price, stop_loss_price, notes, new Date().toISOString()]
        );
    }

    return res.status(200).send({ success: true, message: '筆記已儲存。' });
};
