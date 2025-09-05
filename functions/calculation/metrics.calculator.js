// =========================================================================================
// == 核心指標計算模組 (metrics.calculator.js) - v4.2 (TWD Override Logic)
// =========================================================================================

const { toDate, isTwStock, getTotalCost, findNearest, findFxRate } = require('./helpers');
const { getPortfolioStateOnDate } = require('./state.calculator');

/**
 * 【TWR 核心修正】採用更穩健的計算模型，處理清倉與重建倉位的情況
 */
function calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, startDate, dailyCashflows, log = console.log) {
    const dates = Object.keys(dailyPortfolioValues).sort();
    if (!startDate || dates.length === 0) return { twrHistory: {}, benchmarkHistory: {} };

    const upperBenchmarkSymbol = benchmarkSymbol.toUpperCase();
    const benchmarkPrices = market[upperBenchmarkSymbol]?.prices || {};
    if (Object.keys(benchmarkPrices).length === 0) {
        log(`TWR_CALC_WARN: Benchmark ${upperBenchmarkSymbol} 缺乏歷史價格，將跳過計算。`);
        return { twrHistory: {}, benchmarkHistory: {} };
    }
    
    const benchmarkCurrency = isTwStock(upperBenchmarkSymbol) ? "TWD" : "USD";
    const startFxRate = findFxRate(market, benchmarkCurrency, startDate);
    
    const benchmarkStartPriceInfo = findNearest(benchmarkPrices, startDate);
    if (!benchmarkStartPriceInfo) {
        log(`TWR_CALC_FAIL: Cannot find start price for benchmark ${upperBenchmarkSymbol}.`);
        return { twrHistory: {}, benchmarkHistory: {} };
    }
    const benchmarkStartPriceOriginal = benchmarkStartPriceInfo.value;
    const benchmarkStartPriceTWD = benchmarkStartPriceOriginal * startFxRate;

    const twrHistory = {};
    const benchmarkHistory = {};
    let cumulativeHpr = 1.0;
    let lastMarketValue = 0.0;

    for (const dateStr of dates) {
        const MVE = dailyPortfolioValues[dateStr]; // 當日結束市值 (Market Value End)
        const CF = dailyCashflows[dateStr] || 0;    // 當日現金流 (Cash Flow)
        const MVB = lastMarketValue;                // 當日開始市值 (Market Value Beginning)
        
        let periodHprFactor = 1.0; // 當期報酬率因子，預設為1 (代表0%報酬)

        if (MVB > 1e-9) {
            periodHprFactor = (MVE - CF) / MVB;
        } 
        else if (CF > 1e-9) {
            periodHprFactor = MVE / CF;
        }

        if (!isFinite(periodHprFactor)) {
            periodHprFactor = 1.0;
        }

        cumulativeHpr *= periodHprFactor;
        twrHistory[dateStr] = (cumulativeHpr - 1) * 100;
        lastMarketValue = MVE; 

        const currentBenchPriceInfo = findNearest(benchmarkPrices, new Date(dateStr));
        if (currentBenchPriceInfo && benchmarkStartPriceTWD > 0) {
            const currentBenchPriceOriginal = currentBenchPriceInfo.value;
            const currentFxRate = findFxRate(market, benchmarkCurrency, new Date(dateStr));
            benchmarkHistory[dateStr] = ((currentBenchPriceOriginal * currentFxRate / benchmarkStartPriceTWD) - 1) * 100;
        }
    }
    return { twrHistory, benchmarkHistory };
}


/**
 * 【新增】計算指定日期的每日損益 (Daily Profit/Loss)
 * @param {Date} today - 要計算的目標日期
 * @param {Date} yesterday - 目標日期的前一天
 * @param {Array} allEvts - 所有的事件
 * @param {object} market - 市場數據
 * @returns {number} - 計算出的當日總損益 (TWD)
 */
function calculateDailyPL(today, yesterday, allEvts, market) {
    // 1. 獲取昨日收盤時的持股狀態
    const stateYesterday = getPortfolioStateOnDate(allEvts, yesterday, market);
    let beginningMarketValueTWD = 0;

    for (const sym in stateYesterday) {
        const h = stateYesterday[sym];
        const qty_start_of_day = h.lots.reduce((s, l) => s + l.quantity, 0);

        if (Math.abs(qty_start_of_day) > 1e-9) {
            const priceInfo = findNearest(market[sym]?.prices, yesterday);
            if (priceInfo) {
                const priceBefore = priceInfo.value;
                const fx = findFxRate(market, h.currency, yesterday);
                beginningMarketValueTWD += qty_start_of_day * priceBefore * (h.currency === "TWD" ? 1 : fx);
            }
        }
    }

    // 2. 獲取今日收盤時的市值
    const stateToday = getPortfolioStateOnDate(allEvts, today, market);
    let endingMarketValueTWD = 0;
     for (const sym in stateToday) {
        const h = stateToday[sym];
        const qty_end_of_day = h.lots.reduce((s, l) => s + l.quantity, 0);
        if (Math.abs(qty_end_of_day) > 1e-9) {
            const priceInfo = findNearest(market[sym]?.prices, today);
             if (priceInfo) {
                const priceToday = priceInfo.value;
                const fx = findFxRate(market, h.currency, today);
                endingMarketValueTWD += qty_end_of_day * priceToday * (h.currency === "TWD" ? 1 : fx);
            }
        }
    }

    // 3. 計算今日發生的現金流
    let dailyCashFlowTWD = 0;
    
    const todaysEvents = allEvts.filter(e => toDate(e.date).getTime() === today.getTime());

    for (const e of todaysEvents) {
        if (e.eventType === 'transaction') {
            const fx = findFxRate(market, e.currency, toDate(e.date));
            const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);
            dailyCashFlowTWD += (e.type === 'buy' ? costTWD : -costTWD);
        } 
        else if (e.eventType === 'confirmed_dividend' || e.eventType === 'implicit_dividend') {
            let dividendAmountTWD = 0;
            if (e.eventType === 'confirmed_dividend') {
                // 【核心修改】優先使用手動輸入的台幣金額
                if (e.total_amount_twd && e.total_amount_twd > 0) {
                    dividendAmountTWD = e.total_amount_twd;
                } else {
                    const fx = findFxRate(market, e.currency, toDate(e.date));
                    dividendAmountTWD = e.amount * (e.currency === 'TWD' ? 1 : fx);
                }
            } else { // implicit_dividend
                const stateOnExDate = getPortfolioStateOnDate(allEvts, toDate(e.ex_date), market);
                const shares = stateOnExDate[e.symbol.toUpperCase()]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0;
                if (shares > 0) {
                    const currency = stateOnExDate[e.symbol.toUpperCase()]?.currency || 'USD';
                    const fx = findFxRate(market, currency, toDate(e.date));
                    const postTaxAmount = e.amount_per_share * (1 - (isTwStock(e.symbol) ? 0.0 : 0.30));
                    dividendAmountTWD = postTaxAmount * shares * (currency === "TWD" ? 1 : fx);
                }
            }
            dailyCashFlowTWD -= dividendAmountTWD;
        }
    }

    // 4. 根據公式計算當日損益
    return endingMarketValueTWD - beginningMarketValueTWD - dailyCashFlowTWD;
}


/**
 * [FINAL VERSION 3.0] Calculates the final state of holdings including daily profit/loss.
 */
function calculateFinalHoldings(pf, market, allEvts) {
    const holdingsToUpdate = {};
    
    for (const sym in pf) {
        const h = pf[sym];
        const qty_end_of_day = h.lots.reduce((s, l) => s + l.quantity, 0);

        if (Math.abs(qty_end_of_day) > 1e-9) {
            const totCostTWD = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareTWD, 0);
            const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0);

            const symbolPrices = market[sym]?.prices || {};
            const availableDates = Object.keys(symbolPrices).sort((a, b) => b.localeCompare(a));

            let latestPrice = 0, priceBefore = 0;
            let latestDateStr = new Date().toISOString().split('T')[0];
            let beforeDateStr = new Date().toISOString().split('T')[0];

            if (availableDates.length > 0) {
                latestDateStr = availableDates[0];
                latestPrice = symbolPrices[latestDateStr];
                if (availableDates.length > 1) {
                    beforeDateStr = availableDates[1];
                    priceBefore = symbolPrices[beforeDateStr];
                } else {
                    beforeDateStr = latestDateStr;
                    priceBefore = latestPrice;
                }
            }
            
            const latestPriceDate = new Date(latestDateStr);
            const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym && toDate(e.date) > latestPriceDate);
            const unadjustedPrice = (latestPrice ?? 0) * futureSplits.reduce((acc, split) => acc * split.ratio, 1);
            
            const today = new Date(latestDateStr);
            today.setUTCHours(0, 0, 0, 0);
            const todaysTransactions = allEvts.filter(e =>
                e.eventType === 'transaction' &&
                e.symbol.toUpperCase() === sym &&
                toDate(e.date).getTime() === today.getTime()
            );

            let dailyCashFlowTWD = 0;
            let dailyQuantityChange = 0;
            todaysTransactions.forEach(tx => {
                const fx = findFxRate(market, tx.currency, toDate(tx.date));
                const costTWD = getTotalCost(tx) * (tx.currency === "TWD" ? 1 : fx);
                if (tx.type === 'buy') {
                    dailyCashFlowTWD += costTWD;
                    dailyQuantityChange += tx.quantity;
                } else {
                    dailyCashFlowTWD -= costTWD;
                    dailyQuantityChange -= tx.quantity;
                }
            });

            const qty_start_of_day = qty_end_of_day - dailyQuantityChange;

            const latestFx = findFxRate(market, h.currency, new Date(latestDateStr));
            const beforeFx = findFxRate(market, h.currency, new Date(beforeDateStr));

            const beginningMarketValueTWD = qty_start_of_day * priceBefore * (h.currency === "TWD" ? 1 : beforeFx);
            const endingMarketValueTWD = qty_end_of_day * unadjustedPrice * (h.currency === "TWD" ? 1 : latestFx);
            
            const daily_pl_twd = endingMarketValueTWD - beginningMarketValueTWD - dailyCashFlowTWD;
            const mktVal = endingMarketValueTWD;

            let daily_change_percent = 0;
            const denominator = beginningMarketValueTWD + dailyCashFlowTWD;

            if (Math.abs(denominator) > 1e-9) {
                daily_change_percent = (daily_pl_twd / denominator) * 100;
            }

            holdingsToUpdate[sym] = {
                symbol: sym,
                quantity: qty_end_of_day,
                currency: h.currency,
                avgCostOriginal: totCostOrg !== 0 ? totCostOrg / qty_end_of_day : 0,
                totalCostTWD: totCostTWD,
                currentPriceOriginal: unadjustedPrice,
                marketValueTWD: mktVal,
                unrealizedPLTWD: mktVal - totCostTWD,
                realizedPLTWD: h.realizedPLTWD,
                returnRate: totCostTWD
