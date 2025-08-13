// =========================================================================================
// == 檔案：functions/postTransactionWorker.js (新檔案)
// =========================================================================================
const dataProvider = require('./calculation/data.provider');
const { performRecalculation } = require('./performRecalculation');

/**
 * 處理交易後續的數據完整性檢查與資產重新計算。
 * 此函式應由背景任務觸發。
 * @param {object} payload
 * @param {string} payload.uid - 使用者 ID
 * @param {string} payload.symbol - 交易股票代碼
 * @param {string} payload.txDate - 交易日期
 */
async function postTransactionWorker(payload) {
    const { uid, symbol, txDate } = payload;
    console.log(`[${uid}] 背景任務啟動：處理 ${symbol} 在 ${txDate} 的交易後續。`);

    try {
        // 第一階段：確保數據完整性 (可能是耗時操作)
        console.log(`[${uid}] 檢查 ${symbol} 的市場數據完整性...`);
        // ensureDataCoverage 會智能地只抓取缺少的部分
        await dataProvider.ensureDataCoverage(symbol, txDate);
        console.log(`[${uid}] ${symbol} 的市場數據已確保完整。`);

        // 第二階段：執行資產重新計算 (耗時操作)
        console.log(`[${uid}] 觸發資產重新計算...`);
        await performRecalculation(uid, txDate);
        
        console.log(`[${uid}] 背景任務成功完成。`);
    } catch (e) {
        console.error(`[${uid}] 背景任務執行期間發生嚴重錯誤：`, e);
        // 拋出錯誤，讓 Cloud Tasks 知道任務失敗，以便進行重試
        throw e;
    }
}

module.exports = { postTransactionWorker };
