// =========================================================================================
// == 拆股 Action 處理模組 (split.handler.js)
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { splitSchema } = require('../schemas');

/**
 * 新增一筆拆股事件
 */
exports.addSplit = async (uid, data, res) => {
    const splitData = splitSchema.parse(data);
    const newSplitId = uuidv4();

    await d1Client.query(
        `INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`,
        [newSplitId, uid, splitData.date, splitData.symbol, splitData.ratio]
    );

    await performRecalculation(uid, splitData.date, false);
    return res.status(200).send({ success: true, message: '分割事件已新增。', splitId: newSplitId });
};

/**
 * 刪除一筆拆股事件
 */
exports.deleteSplit = async (uid, data, res) => {
    const splitResult = await d1Client.query(
        'SELECT date FROM splits WHERE id = ? AND uid = ?',
        [data.splitId, uid]
    );
    const splitDate = splitResult.length > 0 ? splitResult[0].date.split('T')[0] : null;

    await d1Client.query(
        'DELETE FROM splits WHERE id = ? AND uid = ?',
        [data.splitId, uid]
    );

    await performRecalculation(uid, splitDate, false);
    return res.status(200).send({ success: true, message: '分割事件已刪除。' });
};
