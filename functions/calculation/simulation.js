// =========================================================================================
// == [新增] 模擬事件生成器 (simulation.js) - v1.0
// == 職責：將回測參數轉換為統一計算引擎可理解的「事件流」。
// =========================================================================================

const { toDate, findNearest } = require('./helpers');

/**
 * 根據指定的再平衡週期，從價格歷史中計算出所有需要再平衡的日期。
 * @param {Object} priceData - 包含所有相關股票價格歷史的物件
 * @param {string} period - 'annually', 'quarterly', 'monthly', 或 'never'
 * @param {Date} startDate - 回測起始日期
 * @param {Date} endDate - 回測結束日期
 * @returns {Date[]} - 一個包含所有再平衡日期的陣列
 */
function getRebalancingDates(priceData, period, startDate, endDate) {
    if (period === 'never') return [];

    // 找到所有股票都存在的共同交易日
    const allDates = new Set();
    Object.values(priceData).forEach(stock => {
        Object.keys(stock.prices).forEach(dateStr => {
            const date = toDate(dateStr);
            if (date >= startDate && date <= endDate) {
                allDates.add(dateStr);
            }
        });
    });
    
    const sortedDates = [...allDates].sort();
    if (sortedDates.length === 0) return [];
    
    const rebalancingDates = new Set();
    let lastMarker = null;

    for (const dateStr of sortedDates) {
        const date = toDate(dateStr);
        let currentMarker;

        switch (period) {
            case 'annually':
                currentMarker = date.getUTCFullYear();
                break;
            case 'quarterly':
                currentMarker = `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
                break;
            case 'monthly':
                currentMarker = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
                break;
            default:
                return [];
        }

        if (currentMarker !== lastMarker && lastMarker !== null) {
            rebalancingDates.add(date);
        }
        lastMarker = currentMarker;
    }

    return Array.from(rebalancingDates);
}

/**
 * 根據回測參數，生成一個模擬的事件流陣列。
 * @param {Object} portfolioConfig - { tickers: string[], weights: number[], rebalancingPeriod: string }
 * @param {Object} marketData - 從 data.provider 獲取的市場數據
 * @param {number} initialAmount - 初始投資金額 (TWD)
 * @param {Date} startDate - 回測起始日期
 * @param {Date} endDate - 回測結束日期
 * @returns {Object[]} - 一個包含模擬交易事件的陣列
 */
function generateSimulatedEvents(portfolioConfig, marketData, initialAmount, startDate, endDate) {
    const { tickers, weights, rebalancingPeriod } = portfolioConfig;
    if (!tickers || tickers.length === 0 || tickers.length !== weights.length) {
        throw new Error("無效的投資組合設定。");
    }

    const events = [];
    const weightsMap = tickers.reduce((acc, ticker, i) => {
        acc[ticker.toUpperCase()] = weights[i] / 100.0;
        return acc;
    }, {});

    // --- 1. 生成初始買入事件 ---
    const firstDayPrices = {};
    for (const ticker of tickers) {
        const upperTicker = ticker.toUpperCase();
        const priceInfo = findNearest(marketData[upperTicker]?.prices || {}, startDate);
        if (!priceInfo) {
            throw new Error(`在回測起始日期 ${startDate.toISOString().split('T')[0]} 附近找不到股票 ${ticker} 的價格數據。`);
        }
        firstDayPrices[upperTicker] = priceInfo.value;
    }

    for (const ticker of tickers) {
        const upperTicker = ticker.toUpperCase();
        const price = firstDayPrices[upperTicker];
        const targetValue = initialAmount * weightsMap[upperTicker];
        const quantity = targetValue / price; // 假設初始交易以 TWD 計價，無需匯率

        if (quantity > 0) {
            events.push({
                eventType: "transaction",
                date: startDate,
                symbol: upperTicker,
                type: 'buy',
                quantity: quantity,
                price: price, // 價格單位為原幣 (此處假設為 TWD)
                currency: 'TWD', // 簡化處理，假設模擬交易均以 TWD 發生
                totalCost: targetValue,
                exchangeRate: 1,
            });
        }
    }

    // --- 2. 生成再平衡事件 ---
    const rebalancingDates = getRebalancingDates(marketData, rebalancingPeriod, startDate, endDate);
    
    // 為了計算再平衡日的市值，我們需要一個簡易的狀態追蹤器
    let tempHoldings = {};
    tickers.forEach(ticker => {
        const upperTicker = ticker.toUpperCase();
        const initialEvent = events.find(e => e.symbol === upperTicker);
        if (initialEvent) {
            tempHoldings[upperTicker] = (tempHoldings[upperTicker] || 0) + initialEvent.quantity;
        }
    });

    for (const rebalanceDate of rebalancingDates) {
        // a. 計算當前市值
        let currentPortfolioValue = 0;
        const pricesOnRebalanceDate = {};

        for (const ticker of tickers) {
            const upperTicker = ticker.toUpperCase();
            const priceInfo = findNearest(marketData[upperTicker]?.prices || {}, rebalanceDate);
            if (priceInfo) {
                pricesOnRebalanceDate[upperTicker] = priceInfo.value;
                currentPortfolioValue += (tempHoldings[upperTicker] || 0) * priceInfo.value;
            } else {
                // 如果找不到價格，則沿用上一次的價格估算
                const lastPriceInfo = findNearest(marketData[upperTicker]?.prices || {}, new Date(rebalanceDate.getTime() - 86400000));
                pricesOnRebalanceDate[upperTicker] = lastPriceInfo ? lastPriceInfo.value : 0;
                currentPortfolioValue += (tempHoldings[upperTicker] || 0) * pricesOnRebalanceDate[upperTicker];
            }
        }
        
        if (currentPortfolioValue === 0) continue;

        // b. 計算目標股數與差異，並生成交易事件
        for (const ticker of tickers) {
            const upperTicker = ticker.toUpperCase();
            const targetValue = currentPortfolioValue * weightsMap[upperTicker];
            const currentQuantity = tempHoldings[upperTicker] || 0;
            const price = pricesOnRebalanceDate[upperTicker];
            
            if (price > 0) {
                const targetQuantity = targetValue / price;
                const quantityDiff = targetQuantity - currentQuantity;

                if (Math.abs(quantityDiff) > 1e-9) { // 只有在差異顯著時才交易
                    const type = quantityDiff > 0 ? 'buy' : 'sell';
                    const absQuantity = Math.abs(quantityDiff);
                    
                    events.push({
                        eventType: "transaction",
                        date: rebalanceDate,
                        symbol: upperTicker,
                        type: type,
                        quantity: absQuantity,
                        price: price,
                        currency: 'TWD',
                        totalCost: absQuantity * price,
                        exchangeRate: 1,
                    });
                    
                    // 更新臨時持股狀態
                    tempHoldings[upperTicker] = targetQuantity;
                }
            }
        }
    }

    return events;
}

module.exports = {
    generateSimulatedEvents,
};
