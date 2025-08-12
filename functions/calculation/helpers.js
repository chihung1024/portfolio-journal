// =========================================================================================
// == 計算輔助函式 (helpers.js)
// == 職責：提供整個計算引擎中可重用的、純粹的工具函式。
// =========================================================================================

/**
 * 將各種格式的輸入值轉換為 UTC 午夜 0 點的 Date 物件
 */
const toDate = (v) => {
    if (!v) return null;
    const d = v.toDate ? v.toDate() : new Date(v);
    if (d instanceof Date && !isNaN(d)) {
        d.setUTCHours(0, 0, 0, 0);
    }
    return d;
};

/**
 * 判斷一個股票代碼是否為台股 (.TW or .TWO)
 */
const isTwStock = (symbol) => {
    return symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
};

/**
 * 從交易物件中獲取總成本 (優先使用 totalCost 欄位)
 */
const getTotalCost = (tx) => {
    return (tx.totalCost != null) ? Number(tx.totalCost) : Number(tx.price || 0) * Number(tx.quantity || 0);
};

/**
 * 從一個以日期字串為 key 的歷史數據物件中，尋找最接近且不大於目標日期的值
 * @param {object} hist - e.g., { '2023-01-01': 100, '2023-01-05': 102 }
 * @param {Date} date - 目標日期
 * @param {number} toleranceDays - 向前尋找的最大天數
 * @returns {any|undefined} 找到的值或 undefined
 */
function findNearest(hist, date, toleranceDays = 7) {
    if (!hist || Object.keys(hist).length === 0) return undefined;
    const tgt = toDate(date);
    if (!tgt) return undefined;

    const tgtStr = tgt.toISOString().slice(0, 10);
    if (hist[tgtStr]) {
        return hist[tgtStr];
    }

    // 依容忍天數，優先往前找最近的日期
    for (let i = 1; i <= toleranceDays; i++) {
        const checkDate = new Date(tgt);
        checkDate.setDate(checkDate.getDate() - i);
        const checkDateStr = checkDate.toISOString().split('T')[0];
        if (hist[checkDateStr]) {
            return hist[checkDateStr];
        }
    }

    // 如果容忍天數內找不到，則找所有歷史紀錄中最接近且不大於目標日期的那一個
    const sortedDates = Object.keys(hist).sort((a, b) => new Date(b) - new Date(a));
    for (const dateStr of sortedDates) {
        if (dateStr <= tgtStr) {
            return hist[dateStr];
        }
    }
    return undefined;
}


/**
 * 尋找指定貨幣在特定日期的匯率 (相對於 TWD)
 * @param {object} market - 完整的市場數據物件
 * @param {string} currency - e.g., 'USD'
 * @param {Date} date - 目標日期
 * @param {number} tolerance - findNearest 的容忍天數
 * @returns {number} 匯率，找不到則返回 1
 */
function findFxRate(market, currency, date, tolerance = 15) {
    // 此處的 currencyToFx 僅為此函式內部使用，與 data.provider 中的保持一致
    const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
    if (!currency || currency === "TWD") return 1;

    const fxSym = currencyToFx[currency];
    if (!fxSym || !market[fxSym]) return 1;

    return findNearest(market[fxSym]?.rates || {}, date, tolerance) ?? 1;
}

module.exports = {
    toDate,
    isTwStock,
    getTotalCost,
    findNearest,
    findFxRate
};
