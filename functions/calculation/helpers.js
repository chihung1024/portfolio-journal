// =========================================================================================
// == 計算輔助函式 (helpers.js) - v_final
// =========================================================================================

const toDate = (v) => {
    if (!v) return null;
    const d = v.toDate ? v.toDate() : new Date(v);
    if (d instanceof Date && !isNaN(d)) {
        d.setUTCHours(0, 0, 0, 0);
    }
    return d;
};

const isTwStock = (symbol) => {
    return symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
};

const getTotalCost = (tx) => {
    return (tx.totalCost != null) ? Number(tx.totalCost) : Number(tx.price || 0) * Number(tx.quantity || 0);
};

/**
 * 增強版：從歷史數據中尋找不大於目標日期的最近值
 * @returns {{date: string, value: any}|undefined} 返回包含日期和值的物件，或 undefined
 */
function findNearest(hist, date, toleranceDays = 7) {
    if (!hist || Object.keys(hist).length === 0) return undefined;
    const tgt = toDate(date);
    if (!tgt) return undefined;

    const tgtStr = tgt.toISOString().slice(0, 10);
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
 * 增強版：尋找指定貨幣在特定日期的匯率 (相對於 TWD)
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
