// =========================================================================================
// == 計算輔-助函式 (helpers.js) - v4.0 (Strictly Historical Find)
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

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【增強版 v2.0】從歷史數據中嚴格尋找不大於目標日期的最近值
 * @returns {{date: string, value: any}|undefined} 返回包含日期和值的物件，或 undefined
 */
function findNearest(hist, date, toleranceDays = 7) {
    if (!hist || Object.keys(hist).length === 0) return undefined;
    const tgt = toDate(date);
    if (!tgt) return undefined;

    const tgtStr = tgt.toISOString().slice(0, 10);

    // 1. 精確匹配：直接查找目標日期
    if (hist[tgtStr] !== undefined && hist[tgtStr] !== null) {
        return { date: tgtStr, value: hist[tgtStr] };
    }

    // 2. 寬容回溯：在指定的 toleranceDays 內，從目標日期向前回溯查找
    // 這一的步驟確保了即使目標日是假日，也能找到最近的交易日數據
    for (let i = 1; i <= toleranceDays; i++) {
        const checkDate = new Date(tgt);
        checkDate.setDate(checkDate.getDate() - i);
        const checkDateStr = checkDate.toISOString().split('T')[0];
        if (hist[checkDateStr] !== undefined && hist[checkDateStr] !== null) {
            return { date: checkDateStr, value: hist[checkDateStr] };
        }
    }

    // 3. 全局回溯 (Fallback)：如果寬容回溯失敗，則遍歷所有鍵，找到不大於目標日期的最近的一個。
    // 這是最穩健的保底策略，確保不會取到未來的數據。
    const sortedDates = Object.keys(hist).sort((a, b) => new Date(b) - new Date(a)); // 降序排列
    for (const dateStr of sortedDates) {
        if (dateStr <= tgtStr) {
            if (hist[dateStr] !== undefined && hist[dateStr] !== null) {
                return { date: dateStr, value: hist[dateStr] };
            }
        }
    }
    
    // 如果連 Fallback 都找不到，代表目標日期遠早於所有歷史數據
    return undefined;
}


/**
 * 【增強版 v2.0】尋找指定貨幣在特定日期的匯率 (相對於 TWD)
 */
function findFxRate(market, currency, date, tolerance = 15) {
    const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
    if (!currency || currency === "TWD") return 1;

    const fxSym = currencyToFx[currency];
    if (!fxSym || !market[fxSym]) {
        console.warn(`[FX Helper] 找不到 ${currency} (${fxSym}) 的市場數據。`);
        return 1;
    }

    // 【修改】使用增強版的 findNearest 函式，並傳入寬容天數
    const result = findNearest(market[fxSym]?.rates || {}, date, tolerance);
    
    if (result) {
        return result.value;
    } else {
        console.warn(`[FX Helper] 在日期 ${date.toISOString().slice(0,10)} 附近找不到 ${fxSym} 的匯率，預設為 1。`);
        return 1;
    }
}
// ========================= 【核心修改 - 結束】 =========================


module.exports = {
    toDate,
    isTwStock,
    getTotalCost,
    findNearest,
    findFxRate
};
