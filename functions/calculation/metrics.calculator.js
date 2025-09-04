// =========================================================================================
// == 核心指標計算模組 (metrics.calculator.js) - v9.0 (Delegated State Calculation)
// == 職責：純粹的指標計算。所有狀態計算都委託給中央的 state.calculator。
// =========================================================================================

const { toDate, isTwStock, getTotalCost, findNearest, findFxRate } = require('./helpers');
// ========================= 【核心修改】 =========================
// 引入新的中央狀態計算機，不再自行計算狀態
const { calculatePortfolioState } = require('./state.calculator');
// ==========================================================

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
 * 計算最終持股狀態，包含每日損益
 * @param {object} pf - 從中央狀態計算機獲取的投資組合狀態
 * @param {object} market - 市場數據
 * @param {Array} allEvts - 所有事件
 * @param {Date} [asOfDate=null] - (可選) 指定計算的日期，用於歷史快照
 * @returns {{holdingsToUpdate: object}} - 更新後的持股物件
 */
function calculateFinalHoldings(pf, market, allEvts, asOfDate = null) {
    const holdingsToUpdate = {};
    
    for (const sym in pf) {
        const h = pf[sym];
        const qty_end_of_day = h.lots.reduce((s, l) => s + l.quantity, 0);

        if (Math.abs(qty_end_of_day) > 1e-9) {
            const totCostTWD = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal * l.fxRateBuy, 0);
            const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0);

            const symbolPrices = market[sym]?.prices || {};
            
            const finalDate = asOfDate ? toDate(asOfDate) : new Date();
            const latestPriceInfo = findNearest(symbolPrices, finalDate);
            const latestPrice = latestPriceInfo ? latestPriceInfo.value : 0;
            const latestPriceDate = latestPriceInfo ? toDate(latestPriceInfo.date) : finalDate;

            const yesterday = new Date(latestPriceDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const priceBeforeInfo = findNearest(symbolPrices, yesterday);
            const priceBefore = priceBeforeInfo ? priceBeforeInfo.value : latestPrice;
            const beforeDateStr = priceBeforeInfo ? priceBeforeInfo.date : (latestPriceInfo ? latestPriceInfo.date : null);

            const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym && toDate(e.date) > latestPriceDate);
            const unadjustedPrice = (latestPrice ?? 0) * futureSplits.reduce((acc, split) => acc * split.ratio, 1);
            
            const today = new Date(latestPriceDate);
            today.setUTCHours(0, 0, 0, 0);
            const todaysTransactions = allEvts.filter(e =>
                e.eventType === 'transaction' &&
                e.symbol.toUpperCase() === sym &&
                toDate(e.date).getTime() === today.getTime()
            );

            let dailyCashFlowTWD = 0;
            let dailyQuantityChange = 0;
            todaysTransactions.forEach(tx => {
                const fx = (tx.exchangeRate && tx.currency !== 'TWD') ? tx.exchangeRate : findFxRate(market, tx.currency, toDate(tx.date));
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

            const latestFx = findFxRate(market, h.currency, latestPriceDate);
            const beforeFx = findFxRate(market, h.currency, beforeDateStr ? new Date(beforeDateStr) : latestPriceDate);

            const beginningMarketValueTWD = qty_start_of_day * priceBefore * (h.currency === "TWD" ? 1 : beforeFx);
            const endingMarketValueTWD = qty_end_of_day * unadjustedPrice * (h.currency === "TWD" ? 1 : latestFx);
            
            const daily_pl_twd = asOfDate ? 0 : endingMarketValueTWD - beginningMarketValueTWD - dailyCashFlowTWD;
            const mktVal = endingMarketValueTWD;

            let daily_change_percent = 0;
            if (!asOfDate) {
                const denominator = beginningMarketValueTWD + dailyCashFlowTWD;
                if (Math.abs(denominator) > 1e-9) {
                    daily_change_percent = (daily_pl_twd / denominator) * 100;
                }
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
                returnRate: totCostTWD !== 0 ? ((mktVal - totCostTWD) / Math.abs(totCostTWD)) * 100 : 0,
                daily_change_percent: daily_change_percent,
                daily_pl_twd: daily_pl_twd
            };
        }
    }
    return { holdingsToUpdate };
}

function createCashflowsForXirr(evts, holdings, market) {
    const flows = [];
    evts.forEach(e => {
        let amt = 0;
        let flowDate = toDate(e.date);
        if (e.eventType === "transaction") {
            const currency = e.currency || 'USD';
            const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, flowDate);
            amt = (e.type === "buy" ? -getTotalCost(e) : getTotalCost(e)) * (currency === 'TWD' ? 1 : fx);
        } else if (e.eventType === "confirmed_dividend") {
            const fx = findFxRate(market, e.currency, flowDate);
            amt = e.amount * (e.currency === 'TWD' ? 1 : fx);
        } else if (e.eventType === "implicit_dividend") {
            const { pf: stateOnDate } = calculatePortfolioState(evts, market, toDate(e.ex_date));
            const sym = e.symbol.toUpperCase();
            const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
            if (shares > 0) {
                const currency = stateOnDate[sym]?.currency || 'USD';
                const fx = findFxRate(market, currency, flowDate);
                const postTaxAmount = e.amount_per_share * (1 - (isTwStock(sym) ? 0.0 : 0.30));
                amt = postTaxAmount * shares * (currency === "TWD" ? 1 : fx);
            }
        }
        if (Math.abs(amt) > 1e-6) {
            flows.push({ date: flowDate, amount: amt });
        }
    });

    const totalMarketValue = Object.values(holdings).reduce((s, h) => s + h.marketValueTWD, 0);
    if (Math.abs(totalMarketValue) > 0) {
        flows.push({ date: new Date(), amount: totalMarketValue });
    }

    const combined = flows.reduce((acc, flow) => {
        const dateStr = flow.date.toISOString().slice(0, 10);
        acc[dateStr] = (acc[dateStr] || 0) + flow.amount;
        return acc;
    }, {});

    return Object.entries(combined)
        .filter(([, amount]) => Math.abs(amount) > 1e-6)
        .map(([date, amount]) => ({ date: new Date(date), amount }))
        .sort((a, b) => a.date - b.date);
}

function calculateXIRR(flows) {
    if (flows.length < 2) return null;
    const amounts = flows.map(f => f.amount);
    if (!amounts.some(v => v < 0) || !amounts.some(v => v > 0)) return null;

    const dates = flows.map(f => f.date);
    const epoch = dates[0].getTime();
    const years = dates.map(d => (d.getTime() - epoch) / (365.25 * 24 * 60 * 60 * 1000));

    let guess = 0.1;
    let npv;
    for (let i = 0; i < 50; i++) {
        npv = amounts.reduce((sum, amount, j) => sum + amount / Math.pow(1 + guess, years[j]), 0);
        if (Math.abs(npv) < 1e-6) return guess;
        const derivative = amounts.reduce((sum, amount, j) => sum - years[j] * amount / Math.pow(1 + guess, years[j] + 1), 0);
        if (Math.abs(derivative) < 1e-9) break;
        guess -= npv / derivative;
    }
    return (npv && Math.abs(npv) < 1e-6) ? guess : null;
}

function calculateDailyCashflows(evts, market) {
    return evts.reduce((acc, e) => {
        const dateStr = toDate(e.date).toISOString().split('T')[0];
        let flow = 0;
        if (e.eventType === 'transaction') {
            const currency = e.currency || 'USD';
            const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, toDate(e.date));
            flow = (e.type === 'buy' ? 1 : -1) * getTotalCost(e) * (currency === 'TWD' ? 1 : fx);
        } else if (e.eventType === 'confirmed_dividend' || e.eventType === 'implicit_dividend') {
            let dividendAmountTWD = 0;
            if (e.eventType === 'confirmed_dividend') {
                const fx = findFxRate(market, e.currency, toDate(e.date));
                dividendAmountTWD = e.amount * (e.currency === 'TWD' ? 1 : fx);
            } else { 
                const { pf: stateOnDate } = calculatePortfolioState(evts, market, toDate(e.ex_date));
                const shares = stateOnDate[e.symbol.toUpperCase()]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0;
                if (shares > 0) {
                    const currency = stateOnDate[e.symbol.toUpperCase()]?.currency || 'USD';
                    const fx = findFxRate(market, currency, toDate(e.date));
                    const postTaxAmount = e.amount_per_share * (1 - (isTwStock(e.symbol) ? 0.0 : 0.30));
                    dividendAmountTWD = postTaxAmount * shares * (currency === "TWD" ? 1 : fx);
                }
            }
            flow = -1 * dividendAmountTWD;
        }

        if (flow !== 0) acc[dateStr] = (acc[dateStr] || 0) + flow;
        return acc;
    }, {});
}


/**
 * 核心指標計算函式
 * @param {Array} evts - 用於計算的事件
 * @param {object} market - 市場數據
 * @param {Date} [asOfDate=null] - (可選) 指定計算的日期，用於歷史快照
 * @returns {object} - 包含所有核心指標的物件
 */
function calculateCoreMetrics(evts, market, asOfDate = null) {
    // ========================= 【核心修改】 =========================
    // 步驟 1: 調用唯一的中央狀態計算機，獲取截至目標日期的、絕對正確的投資組合狀態
    const { pf, totalRealizedPL } = calculatePortfolioState(evts, market, asOfDate);
    // ==========================================================

    // ========================= 【核心修改】 =========================
    // 步驟 2: 基於這個正確的狀態，計算最終的持股詳情 (包含未實現損益)
    const { holdingsToUpdate } = calculateFinalHoldings(pf, market, evts, asOfDate);
    // ==========================================================

    // 步驟 3: 基於正確的持股狀態，計算 XIRR
    const xirrFlows = createCashflowsForXirr(evts, holdingsToUpdate, market);
    const xirr = calculateXIRR(xirrFlows);
    
    // 步驟 4: 計算總結指標
    const totalUnrealizedPL = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.unrealizedPLTWD, 0);
    const totalProfitAndLoss = totalRealizedPL + totalUnrealizedPL;
    
    const totalBuyCostTWD = evts
        .filter(e => e.eventType === 'transaction' && e.type === 'buy')
        .reduce((sum, e) => {
            const fx = (e.exchangeRate && e.currency !== 'TWD') ? e.exchangeRate : findFxRate(market, e.currency, toDate(e.date));
            return sum + getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);
        }, 0);
    
    const overallReturnRate = totalBuyCostTWD > 0 ? (totalProfitAndLoss / totalBuyCostTWD) * 100 : 0;
    
    return { 
        holdings: { holdingsToUpdate }, 
        totalRealizedPL, 
        totalUnrealizedPL,
        xirr, 
        overallReturnRate 
    };
}

module.exports = {
    calculateTwrHistory,
    calculateFinalHoldings,
    createCashflowsForXirr,
    calculateXIRR,
    calculateDailyCashflows,
    calculateCoreMetrics,
    // DailyPL is no longer needed as net profit is now derived from core metrics
};
