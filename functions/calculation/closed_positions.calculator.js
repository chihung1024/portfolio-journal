// =========================================================================================
// == 平倉紀錄計算機 (closed_positions.calculator.js) - 【新檔案】
// == 職責：採用 FIFO (先進先出) 原則，計算並產生詳細的平倉損益報告。
// =========================================================================================

const { findFxRate } = require('./helpers');

/**
 * 輔助函式：將原始交易物件轉換為包含 TWD 成本的標準化格式
 * @param {object} tx - 原始交易物件
 * @param {object} market - 市場數據，用於查找匯率
 * @returns {object} - 標準化後的交易物件
 */
function normalizeTransaction(tx, market) {
    const totalCostOriginal = tx.totalCost != null ? Number(tx.totalCost) : Number(tx.price || 0) * Number(tx.quantity || 0);
    const fxRate = (tx.exchangeRate && tx.currency !== 'TWD') ? tx.exchangeRate : findFxRate(market, tx.currency, new Date(tx.date));
    const totalCostTWD = totalCostOriginal * (tx.currency === 'TWD' ? 1 : fxRate);

    return {
        ...tx,
        // 為確保一致性，所有後續計算都基於這兩個標準化欄位
        _totalCostOriginal: totalCostOriginal,
        _totalCostTWD: totalCostTWD,
        _pricePerShareTWD: totalCostTWD / tx.quantity,
    };
}

/**
 * 核心 FIFO 平倉計算邏輯
 * @param {string} symbol - 要計算的股票代碼
 * @param {Array<object>} transactions - 該股票的所有交易紀錄
 * @param {object} market - 市場數據
 * @returns {object|null} - 包含已實現損益和交易明細的物件，或在沒有平倉時回傳 null
 */
function calculateFifoClosedPositions(symbol, transactions, market) {
    if (!transactions || transactions.length === 0) {
        return null;
    }

    // 1. 標準化所有交易並按日期排序
    const normalizedTxs = transactions.map(tx => normalizeTransaction(tx, market));
    normalizedTxs.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 2. 將買入和賣出交易分開
    const buys = normalizedTxs.filter(t => t.type === 'buy').map(t => ({ ...t, remainingQty: t.quantity }));
    const sells = normalizedTxs.filter(t => t.type === 'sell');

    if (sells.length === 0) {
        return null; // 沒有賣出交易，代表沒有平倉
    }

    const closedLots = [];
    let totalRealizedPL = 0;
    let totalCostBasis = 0;
    let totalProceeds = 0;

    let currentBuyIndex = 0;

    // 3. 遍歷所有賣出交易
    for (const sell of sells) {
        let sellQtyToMatch = sell.quantity;
        const proceedsFromThisSell = sell._totalCostTWD;
        
        const lotTransactions = []; // 追蹤構成此平倉批次的具體交易
        let costBasisForThisSell = 0;

        // 4. 從最早的買入交易開始進行配對
        while (sellQtyToMatch > 0 && currentBuyIndex < buys.length) {
            const buy = buys[currentBuyIndex];

            // 確定本次配對的數量
            const matchQty = Math.min(sellQtyToMatch, buy.remainingQty);

            if (matchQty > 0) {
                // 計算此部分配對的成本
                const costOfMatchedQty = buy._pricePerShareTWD * matchQty;
                costBasisForThisSell += costOfMatchedQty;
                
                // 更新剩餘數量
                buy.remainingQty -= matchQty;
                sellQtyToMatch -= matchQty;

                // 記錄部分使用的交易紀錄
                lotTransactions.push({ ...buy, usedQty: matchQty });
            }

            // 如果最早的買入交易已用完，則移至下一個
            if (buy.remainingQty < 1e-9) {
                currentBuyIndex++;
            }
        }
        
        // 只有當賣出數量被完全配對時，才認為這是一筆有效的平倉交易
        if (Math.abs(sellQtyToMatch) < 1e-9) {
            const realizedPL = proceedsFromThisSell - costBasisForThisSell;
            
            // 將當前這筆賣出交易也加入到批次紀錄中
            lotTransactions.push({ ...sell, usedQty: sell.quantity });
            
            closedLots.push({
                closingDate: sell.date.split('T')[0],
                realizedPL: realizedPL,
                costBasis: costBasisForThisSell,
                proceeds: proceedsFromThisSell,
                transactions: lotTransactions,
            });

            // 累加總計
            totalRealizedPL += realizedPL;
            totalCostBasis += costBasisForThisSell;
            totalProceeds += proceedsFromThisSell;
        }
    }
    
    // 如果沒有任何一筆完整的平倉交易，則回傳 null
    if (closedLots.length === 0) {
        return null;
    }

    return {
        symbol: symbol.toUpperCase(),
        totalRealizedPL,
        totalCostBasis,
        totalProceeds,
        closedLots,
    };
}

module.exports = {
    calculateFifoClosedPositions,
};
