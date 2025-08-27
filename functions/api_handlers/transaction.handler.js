// =========================================================================================
// == 交易 Action 處理模組 (transaction.handler.js) v3.2 - 導出輔助函式
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { performRecalculation } = require('../performRecalculation');
const { transactionSchema } = require('../schemas');
const dataProvider = require('../calculation/data.provider');


// ========================= 【核心修改 - 開始】 =========================

/**
 * 【新增輔助函式】將與一筆交易相關的所有群組標記為 "dirty"，以觸發快取重新計算。
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
    return null; // 如果資料庫中完全沒有該貨幣的匯率，則返回 null
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

// 函式導出
exports.populateSettlementFxRate = populateSettlementFxRate;

// ========================= 【核心修改 - 結束】 =========================


/**
 * 新增一筆交易紀錄 (支援引導式群組歸因)
 */
exports.addTransaction = async (uid, data, res) => {
    const { txData, groupInclusions, newGroups } = data;
    let parsedTxData = transactionSchema.parse(txData);
    const txId = uuidv4();

    parsedTxData = await populateSettlementFxRate(parsedTxData);

    const dbOps = [];

    // 步驟 1: (可選) 如果有新群組建立請求，先建立新群組
    const newGroupIdMap = {};
    if (newGroups && newGroups.length > 0) {
        newGroups.forEach(group => {
            const newGroupId = uuidv4();
            newGroupIdMap[group.tempId] = newGroupId;
            dbOps.push({
                sql: `INSERT INTO groups (id, uid, name, description, is_dirty) VALUES (?, ?, ?, ?, 1)`, // 新建的群組預設為 dirty
                params: [newGroupId, uid, group.name, '']
            });
        });
    }

    // 步驟 2: 插入新的交易紀錄
    dbOps.push({
        sql: `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [txId, uid, parsedTxData.date, parsedTxData.symbol, parsedTxData.type, parsedTxData.quantity, parsedTxData.price, parsedTxData.currency, parsedTxData.totalCost, parsedTxData.exchangeRate]
    });

    // 步驟 3: (可選) 處理交易的群組歸屬
    const finalGroupIdsToMarkDirty = new Set();
    if (groupInclusions && groupInclusions.length > 0) {
        groupInclusions.forEach(groupId => {
            const finalGroupId = newGroupIdMap[groupId] || groupId;
            finalGroupIdsToMarkDirty.add(finalGroupId);
            dbOps.push({
                sql: `INSERT INTO group_transaction_inclusions (uid, group_id, transaction_id) VALUES (?, ?, ?)`,
                params: [uid, finalGroupId, txId]
            });
        });
    }

    await d1Client.batch(dbOps);

    // 【新增】將所有被關聯的群組標記為 dirty
    if (finalGroupIdsToMarkDirty.size > 0) {
        const groupIds = Array.from(finalGroupIdsToMarkDirty);
        const placeholders = groupIds.map(() => '?').join(',');
        await d1Client.query(
            `UPDATE groups SET is_dirty = 1 WHERE uid = ? AND id IN (${placeholders})`,
            [uid, ...groupIds]
        );
    }

    // 執行同步的全局重算
    await performRecalculation(uid, parsedTxData.date, false);

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
        message: '操作成功。',
        id: txId,
        data: {
            holdings: holdings,
            summary: summary_data,
            history: portfolioHistory,
            twrHistory,
            netProfitHistory,
            benchmarkHistory
        }
    });
};

/**
 * 編輯一筆現有的交易紀錄
 */
exports.editTransaction = async (uid, data, res) => {
    let txData = transactionSchema.parse(data.txData);
    const txId = data.txId;

    txData = await populateSettlementFxRate(txData);

    const oldTxResult = await d1Client.query('SELECT symbol FROM transactions WHERE id = ? AND uid = ?', [txId, uid]);
    if (oldTxResult.length === 0) {
        return res.status(404).send({ success: false, message: '找不到指定的交易紀錄。' });
    }
    const oldSymbol = oldTxResult[0].symbol.toUpperCase();
    const newSymbol = txData.symbol.toUpperCase();

    const dbOps = [];

    // 如果股票代碼被修改，則自動清除其所有舊的群組歸屬
    if (oldSymbol !== newSymbol) {
        console.log(`[Data Integrity] Transaction ${txId} symbol changed from ${oldSymbol} to ${newSymbol}. Resetting group memberships.`);
        // 【新增】在清除歸屬前，先將舊的關聯群組標記為 dirty
        await markAssociatedGroupsAsDirty(uid, txId);
        dbOps.push({
            sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?',
            params: [uid, txId]
        });
    }

    dbOps.push({
        sql: `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
        params: [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
    });

    if (dbOps.length > 0) {
        await d1Client.batch(dbOps);
    }

    // 【新增】將與此交易相關的群組標記為 dirty
    await markAssociatedGroupsAsDirty(uid, txId);

    await performRecalculation(uid, txData.date, false);

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
        message: '操作成功。',
        id: txId,
        data: {
            holdings: holdings,
            summary: summary_data,
            history: portfolioHistory,
            twrHistory,
            netProfitHistory,
            benchmarkHistory
        }
    });
};

/**
 * 刪除一筆交易紀錄
 */
exports.deleteTransaction = async (uid, data, res) => {
    const txResult = await d1Client.query(
        'SELECT date FROM transactions WHERE id = ? AND uid = ?',
        [data.txId, uid]
    );
    const txDate = txResult.length > 0 ? txResult[0].date.split('T')[0] : null;

    // 【新增】在刪除前，先將與此交易相關的群組標記為 dirty
    await markAssociatedGroupsAsDirty(uid, data.txId);

    const deleteOps = [
        {
            sql: 'DELETE FROM group_transaction_inclusions WHERE uid = ? AND transaction_id = ?',
            params: [uid, data.txId]
        },
        {
            sql: 'DELETE FROM transactions WHERE id = ? AND uid = ?',
            params: [data.txId, uid]
        }
    ];

    await d1Client.batch(deleteOps);

    await performRecalculation(uid, txDate, false);

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
        message: '交易已刪除。',
        data: {
            holdings: holdings,
            summary: summary_data,
            history: portfolioHistory,
            twrHistory,
            netProfitHistory,
            benchmarkHistory
        }
    });
};
