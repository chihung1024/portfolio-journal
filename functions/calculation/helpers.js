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
/**
 * 從一個以日期字串為 key 的歷史數據物件中，尋找最接近且不大於目標日期的值
 * @returns {{date: string, value: any}|undefined} 返回包含日期和值的物件，或 undefined
 */
function findNearest(hist, date, toleranceDays = 7) {
    if (!hist || Object.keys(hist).length === 0) return undefined;
    const tgt = toDate(date);
    if (!tgt) return undefined;

    let tgtStr = tgt.toISOString().slice(0, 10);
    if (hist[tgtStr]) {
        return { date: tgtStr, value: hist[tgtStr] };
    }

    for (let i = 1; i <= toleranceDays; i++) {
        const checkDate = new Date(tgt);
        checkDate.setDate(checkDate.getDate() - i);
        const checkDateStr = checkDate.toISOString().split('T')[0];
        if (hist[checkDateStr]) {
            return { date: checkDateStr, value: hist[checkDateStr] };
        }
    }

    const sortedDates = Object.keys(hist).sort((a, b) => new Date(b) - new Date(a));
    for (const dateStr of sortedDates) {
        if (dateStr <= tgtStr) {
            return { date: dateStr, value: hist[dateStr] };
        }
    }
    return undefined;
}


/**
 * 尋找指定貨幣在特定日期的匯率 (相對於 TWD)
 * 【適配性修改】
 */
function findFxRate(market, currency, date, tolerance = 15) {
    const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
    if (!currency || currency === "TWD") return 1;

    const fxSym = currencyToFx[currency];
    if (!fxSym || !market[fxSym]) return 1;

    const result = findNearest(market[fxSym]?.rates || {}, date, tolerance);
    return result ? result.value : 1;
}

module.exports = {
    toDate,
    isTwStock,
    getTotalCost,
    findNearest,
    findFxRate
};
