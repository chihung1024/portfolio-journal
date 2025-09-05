// =========================================================================================
// == 平倉紀錄計算機 (closed_positions.calculator.js) - v2.0 (Dividend-Aware & Robust FIFO)
// == 職責：採用 FIFO (先進先出) 原則，計算並產生詳細的平倉損益報告。
// =========================================================================================

const { findFxRate } = require('./helpers');

/**
 * 輔助函式：將原始交易物件轉換為包含 TWD 成本的標準化格式
 */
function normalizeTransaction(tx, market) {
    const totalCostOriginal = tx.totalCost != null ? Number(tx.totalCost) : Number(tx.price || 0) * Number(tx.quantity || 0);
    const fxRate = (tx.exchangeRate && tx.currency !== 'TWD') ? tx.exchangeRate : findFxRate(market, tx.currency, new Date(tx.date));
    const totalCostTWD = totalCostOriginal * (tx.currency === 'TWD' ? 1 : fxRate);

    return {
        ...tx,
        _totalCostOriginal: totalCostOriginal,
        _totalCostTWD: totalCostTWD,
        _pricePerShareTWD: totalCostTWD / tx.quantity,
    };
}

/**
 * 【核心重構】更穩健的 FIFO 平倉計算邏輯，並整合股利計算
 * @param {string} symbol - 要計算的股票代碼
 * @param {Array<object>} transactions - 該股票的所有交易紀錄
 * @param {Array<object>} dividends - 該股票的所有已確認股利紀錄
 * @param {object} market - 市場數據
 * @returns {object|null} - 包含已實現損益和交易明細的物件，或在沒有平倉時回傳 null
 */
function calculateFifoClosedPositions(symbol, transactions, dividends, market) {
    if (!transactions || transactions.length === 0) {
        return null;
    }

    const normalizedTxs = transactions.map(tx => normalizeTransaction(tx, market));
    normalizedTxs.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const dividendsTwd = dividends.map(d => {
        const fxRate = findFxRate(market, d.currency, new Date(d.pay_date));
        return {
            ...d,
            pay_date: d.pay_date.split('T')[0],
            _totalAmountTWD: d.total_amount * (d.currency === 'TWD' ? 1 : fxRate)
        };
    }).sort((a, b) => new Date(a.pay_date) - new Date(b.pay_date));

    const buysQueue = normalizedTxs.filter(t => t.type === 'buy').map(t => ({ ...t, remainingQty: t.quantity }));
    const sells = normalizedTxs.filter(t => t.type === 'sell');

    if (sells.length === 0) {
        return null;
    }

    const closedLots = [];
    let totalRealizedPL = 0;
    let totalCostBasis = 0;
    let totalProceeds = 0;
    let totalDividends = 0;

    for (const sell of sells) {
        let sellQtyToMatch = sell.quantity;
        const proceedsFromThisSell = sell._totalCostTWD;
        
        const lotTransactions = [];
        let costBasisForThisSell = 0;
        let openingDate = null;

        while (sellQtyToMatch > 0 && buysQueue.length > 0) {
            const buy = buysQueue[0];
            if (!openingDate) {
                openingDate = buy.date.split('T')[0];
            }

            const matchQty = Math.min(sellQtyToMatch, buy.remainingQty);

            if (matchQty > 0) {
                const costOfMatchedQty = (buy._totalCostTWD / buy.quantity) * matchQty;
                costBasisForThisSell += costOfMatchedQty;
                
                buy.remainingQty -= matchQty;
                sellQtyToMatch -= matchQty;

                lotTransactions.push({ ...buy, usedQty: matchQty });
            }

            if (buy.remainingQty < 1e-9) {
                buysQueue.shift();
            }
        }
        
        if (Math.abs(sellQtyToMatch) < 1e-9) {
            const closingDate = sell.date.split('T')[0];
            
            // 計算此平倉期間內的股利收入
            const dividendsForThisLot = dividendsTwd.filter(d => 
                d.pay_date >= openingDate && d.pay_date <= closingDate
            );
            
            //【注意】此為簡化歸因，實際應按每日持股比例分配。但此模型已能大幅提高準確度。
            // 我們假設此期間收到的所有股利都歸因於這一批平倉交易。
            const dividendsReceivedTWD = dividendsForThisLot.reduce((sum, d) => sum + d._totalAmountTWD, 0);

            const realizedPL = proceedsFromThisSell - costBasisForThisSell + dividendsReceivedTWD;
            
            lotTransactions.push({ ...sell, usedQty: sell.quantity });
            
            closedLots.push({
                openingDate: openingDate,
                closingDate: closingDate,
                realizedPL: realizedPL,
                costBasis: costBasisForThisSell,
                proceeds: proceedsFromThisSell,
                dividends: dividendsReceivedTWD,
                transactions: lotTransactions,
            });

            totalRealizedPL += realizedPL;
            totalCostBasis += costBasisForThisSell;
            totalProceeds += proceedsFromThisSell;
            totalDividends += dividendsReceivedTWD;

            // 從股利列表中移除已歸因的股利，避免重複計算
            dividendsForThisLot.forEach(d => {
                const index = dividendsTwd.indexOf(d);
                if (index > -1) dividendsTwd.splice(index, 1);
            });
        }
    }
    
    if (closedLots.length === 0) {
        return null;
    }

    return {
        symbol: symbol.toUpperCase(),
        totalRealizedPL,
        totalCostBasis,
        totalProceeds,
        totalDividends,
        closedLots,
    };
}

module.exports = {
    calculateFifoClosedPositions,
};
