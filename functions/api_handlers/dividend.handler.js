// =========================================================================================
// == 股利 Action 處理模組 (dividend.handler.js) v3.0 - Refactored for Staging
// == 職責：提供股利相關的讀取 API 與輔助函式。CUD 操作已移至 staging.handler。
// =========================================================================================

const { d1Client } = require('../d1.client');
// 【移除】不再需要 uuid, performRecalculation 和 schemas
// const { v4: uuidv4 } = require('uuid');
// const { performRecalculation } = require('../performRecalculation');
// const { userDividendSchema } = require('../schemas');


/**
 * 【保留】根據股票代碼(們)，將所有包含這些股票的群組標記為 "dirty"。
 * @param {string} uid - 使用者 ID
 * @param {string|string[]} symbols - 單一或多個發生變更的股票代碼
 */
async function markAssociatedGroupsAsDirtyBySymbol(uid, symbols) {
    const symbolList = Array.isArray(symbols) ? [...new Set(symbols)] : [symbols];
    if (symbolList.length === 0) return;

    // 1. 找出這些股票的所有 transaction_id
    const txPlaceholders = symbolList.map(() => '?').join(',');
    const txIdsResult = await d1Client.query(
        `SELECT id FROM transactions WHERE uid = ? AND symbol IN (${txPlaceholders})`,
        [uid, ...symbolList]
    );
    const txIds = txIdsResult.map(r => r.id);

    if (txIds.length > 0) {
        // 2. 找出包含這些交易的所有 group_id
        const groupTxPlaceholders = txIds.map(() => '?').join(',');
        const groupIdsResult = await d1Client.query(
            `SELECT DISTINCT group_id FROM group_transaction_inclusions WHERE uid = ? AND transaction_id IN (${groupTxPlaceholders})`,
            [uid, ...txIds]
        );
        const groupIds = groupIdsResult.map(r => r.group_id);

        if (groupIds.length > 0) {
            // 3. 將這些群組全部標記為 dirty
            const groupPlaceholders = groupIds.map(() => '?').join(',');
            await d1Client.query(
                `UPDATE groups SET is_dirty = 1 WHERE uid = ? AND id IN (${groupPlaceholders})`,
                [uid, ...groupIds]
            );
            console.log(`[Cache Invalidation] Marked groups as dirty due to dividend change for symbols ${symbolList.join(', ')}: ${groupIds.join(', ')}`);
        }
    }
}


/**
 * 【保留】獲取待確認及已確認的股利列表 (唯讀操作)
 */
exports.getDividendsForManagement = async (uid, res) => {
    const [pendingDividends, confirmedDividends] = await Promise.all([
        d1Client.query('SELECT * FROM user_pending_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid]),
        d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY pay_date DESC', [uid])
    ]);

    return res.status(200).send({
        success: true,
        data: {
            pendingDividends: pendingDividends || [],
            confirmedDividends: confirmedDividends || []
        }
    });
};

// ========================= 【核心修改 - 開始】 =========================

// 【移除】saveUserDividend 函式
// 理由：新增/編輯股利的操作現在由前端發起 'stage_change' API，
//       並由 staging.handler.js 的 'commitAllChanges' 統一處理。
/*
exports.saveUserDividend = async (uid, data, res) => { ... };
*/

// 【移除】bulkConfirmAllDividends 函式
// 理由：批次確認的操作也將由 staging area 統一管理。
/*
exports.bulkConfirmAllDividends = async (uid, data, res) => { ... };
*/

// 【移除】deleteUserDividend 函式
// 理由：刪除股利的操作也將由 staging area 統一管理。
/*
exports.deleteUserDividend = async (uid, data, res) => { ... };
*/


// 導出需要保留的函式
module.exports.markAssociatedGroupsAsDirtyBySymbol = markAssociatedGroupsAsDirtyBySymbol;

// ========================= 【核心修改 - 結束】 =========================