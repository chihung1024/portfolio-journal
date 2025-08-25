// =========================================================================================
// == 拆股 Action 處理模組 (split.handler.js) v3.0 - Staging-Ready
// =========================================================================================

const { splitSchema } = require('../schemas');
const { stageChange } = require('./staging.handler'); // 導入暫存區處理器

// ========================= 【核心修改 - 開始】 =========================

/**
 * 將「新增拆股」的請求轉發至暫存區
 */
exports.addSplit = async (uid, data, res) => {
    const splitData = splitSchema.parse(data);
    // 直接呼叫 stageChange，將具體操作交給 staging.handler 處理
    return await stageChange(uid, { op: 'CREATE', entity: 'split', payload: splitData }, res);
};

/**
 * 將「刪除拆股」的請求轉發至暫存區
 */
exports.deleteSplit = async (uid, data, res) => {
    // 只需傳遞 ID 即可
    return await stageChange(uid, { op: 'DELETE', entity: 'split', payload: { id: data.splitId } }, res);
};

// ========================= 【核心修改 - 結束】 =========================