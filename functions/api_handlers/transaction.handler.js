// =========================================================================================
// == 交易輔助邏輯模組 (transaction.handler.js) v4.0 - Refactored for Staging
// == 職責：提供交易相關的輔助函式，主要由 staging.handler 調用。
// ==      原有的 add/edit/delete 已廢棄，邏輯集中到 staging.handler。
// =========================================================================================

const { d1Client } = require('../d1.client');

/**
 * 將與一筆交易相關的所有群組標記為 "dirty"，以觸發快取重新計算。
 * @param {string} uid - 使用者 ID
 * @param {string} transactionId - 發生變更的交易 ID
 */
async function markAssociatedGroupsAsDirty(uid, transactionId) {
    // 1. 找出包含此交易的所有 group_id
    const groupIdsResult = await d1Client.query(
        'SELECT group_id FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?',
        [uid, transactionId]
    );
    const groupIds = groupIdsResult.map(r => r.group_id);

    if (groupIds.length > 0) {
        // 2. 將這些群組全部標記為 dirty
        const placeholders = groupIds.map(() => '?').join(',');
        await d1Client.query(
            `UPDATE groups SET is_dirty = 1 WHERE uid = ? AND id IN (${placeholders})`,
            [uid, ...groupIds]
        );
        console.log(`[Cache Invalidation] Marked groups as dirty due to transaction change: ${groupIds.join(', ')}`);
    }
}


/**
 * 尋找最接近結算日的未來匯率，並在找不到時 fallback 至資料庫中最新的匯率
 * @param {string} currency - 貨幣代碼 (例如 'USD')
 * @param {string} txDateStr - 交易日期字串 (YYYY-MM-DD)
 * @param {number} settlementDays - T+幾日結算 (例如 1 或 2)
 * @returns {Promise<number|null>} - 返回找到的匯率，或 null
 */
async function findSettlementFxRate(currency, txDateStr, settlementDays) {
    if (currency === 'TWD') return 1;

    const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
    const fxSymbol = currencyToFx[currency];
    if (!fxSymbol) return null;

    const transactionDate = new Date(txDateStr);
    const targetSettlementDate = new Date(transactionDate);
    targetSettlementDate.setDate(transactionDate.getDate() + settlementDays);
    const targetSettlementDateStr = targetSettlementDate.toISOString().split('T')[0];

    // 步驟 1: 嘗試從資料庫尋找未來的交割日匯率
    const futureRateResult = await d1Client.query(
        'SELECT price FROM exchange_rates WHERE symbol = ? AND date >= ? ORDER BY date ASC LIMIT 1',
        [fxSymbol, targetSettlementDateStr]
    );

    if (futureRateResult && futureRateResult.length > 0) {
        console.log(`[FX Logic] For ${currency} on ${txDateStr} (T+${settlementDays}), found future settlement rate ${futureRateResult[0].price} from DB.`);
        return futureRateResult[0].price;
    }

    // 步驟 2: 【智慧 Fallback】若找不到，則從資料庫中抓取最新的匯率紀錄
    console.warn(`[FX Logic] For ${currency} on ${txDateStr}, could not find a future settlement rate. Fallback: fetching latest rate from DB.`);

    const latestRateResult = await d1Client.query(
        'SELECT price FROM exchange_rates WHERE symbol = ? ORDER BY date DESC LIMIT 1',
        [fxSymbol]
    );

    if (latestRateResult && latestRateResult.length > 0) {
        console.log(`[FX Logic] Fallback successful. Using latest available rate for ${fxSymbol}: ${latestRateResult[0].price}`);
        return latestRateResult[0].price;
    }

    console.error(`[FX Logic] Fallback failed: Could not find any historical rate for ${fxSymbol} in the database.`);
    return null; 
}

/**
 * 為交易數據填充結算匯率的核心邏輯
 * @param {object} txData - 已通過 schema 驗證的交易數據
 */
async function populateSettlementFxRate(txData) {
    // 只有在非台幣且使用者未手動提供匯率時才觸發
    if (txData.currency !== 'TWD' && (txData.exchangeRate == null || txData.exchangeRate === 0)) {
        const settlementDays = txData.type === 'buy' ? 1 : 2;
        const calculatedRate = await findSettlementFxRate(txData.currency, txData.date, settlementDays);
        if (calculatedRate) {
            txData.exchangeRate = calculatedRate;
        }
    }
    return txData;
}


// 導出輔助函式，供其他 handler (主要是 staging.handler) 使用
module.exports = {
    markAssociatedGroupsAsDirty,
    populateSettlementFxRate
};