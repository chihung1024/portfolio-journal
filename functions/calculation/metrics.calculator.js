// =========================================================================================
// == 核心指標計算模組 (metrics.calculator.js) - v2.0 (整合回測指標)
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


function calculateFinalHoldings(pf, market, allEvts) {
    const holdingsToUpdate = {};
    
    for (const sym in pf) {
        const h = pf[sym];
        const qty = h.lots.reduce((s, l) => s + l.quantity, 0);

        if (Math.abs(qty) > 1e-9) {
            const totCostTWD = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareTWD, 0);
            const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0);

            const symbolPrices = market[sym]?.prices || {};
            const availableDates = Object.keys(symbolPrices).sort((a, b) => b.localeCompare(a)); 

            let latestPrice = 0;
            let priceBefore = 0;
            let latestPriceDate = new Date();

            if (availableDates.length > 0) {
                const latestDateStr = availableDates[0];
                latestPrice = symbolPrices[latestDateStr];
                latestPriceDate = new Date(latestDateStr);

                if (availableDates.length > 1) {
                    const beforeDateStr = availableDates[1];
                    priceBefore = symbolPrices[beforeDateStr];
                } else {
                    priceBefore = latestPrice;
                }
            }
            
            const fx = findFxRate(market, h.currency, latestPriceDate);
            const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym.toUpperCase() && toDate(e.date) > latestPriceDate);
            const unadjustedPrice = (latestPrice ?? 0) * futureSplits.reduce((acc, split) => acc * split.ratio, 1);
            
            const mktVal = qty * unadjustedPrice * (h.currency === "TWD" ? 1 : fx);
            
            const daily_change_percent = priceBefore > 0 ? ((unadjustedPrice - priceBefore) / priceBefore) * 100 : 0;
            const daily_pl_twd = (unadjustedPrice - priceBefore) * qty * fx;

            holdingsToUpdate[sym] = {
                symbol: sym,
                quantity: qty,
                currency: h.currency,
                avgCostOriginal: totCostOrg !== 0 ? totCostOrg / qty : 0,
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
            const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market);
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
                const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market);
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

function calculateCoreMetrics(evts, market) {
    const pf = {};
    let totalRealizedPL = 0;
    let totalBuyCostTWD = 0; 

    for (const e of evts) {
        const sym = e.symbol.toUpperCase();
        if (!pf[sym]) {
            pf[sym] = { lots: [], currency: e.currency || "USD", realizedPLTWD: 0 };
        }
        pf[sym].currency = e.currency;

        switch (e.eventType) {
            case "transaction": {
                const fx = (e.exchangeRate && e.currency !== 'TWD') ? e.exchangeRate : findFxRate(market, e.currency, toDate(e.date));
                
                if (e.type === "buy") {
                    const buyCostTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);
                    totalBuyCostTWD += buyCostTWD; 

                    let buyQty = e.quantity;
                    const buyPricePerShareTWD = buyCostTWD / (e.quantity || 1);
                    
                    pf[sym].lots.sort((a,b) => a.date - b.date);
                    while (buyQty > 0 && pf[sym].lots.length > 0 && pf[sym].lots[0].quantity < 0) {
                        const shortLot = pf[sym].lots[0];
                        const qtyToCover = Math.min(buyQty, -shortLot.quantity);
                        
                        const proceedsFromShort = qtyToCover * shortLot.pricePerShareTWD;
                        const costToCover = qtyToCover * buyPricePerShareTWD;
                        const realizedPL = proceedsFromShort - costToCover;
                        
                        totalRealizedPL += realizedPL;
                        pf[sym].realizedPLTWD += realizedPL;
                        
                        shortLot.quantity += qtyToCover;
                        buyQty -= qtyToCover;

                        if (Math.abs(shortLot.quantity) < 1e-9) {
                            pf[sym].lots.shift();
                        }
                    }
                    
                    if (buyQty > 1e-9) {
                        pf[sym].lots.push({ 
                            quantity: buyQty, 
                            pricePerShareOriginal: e.price, 
                            pricePerShareTWD: buyPricePerShareTWD, 
                            date: toDate(e.date) 
                        });
                    }
                } else { // sell
                    let sellQty = e.quantity;
                    const sellPricePerShareTWD = (getTotalCost(e) / (e.quantity || 1)) * (e.currency === "TWD" ? 1 : fx);

                    pf[sym].lots.sort((a,b) => a.date - b.date);
                    while (sellQty > 0 && pf[sym].lots.length > 0 && pf[sym].lots[0].quantity > 0) {
                        const longLot = pf[sym].lots[0];
                        const qtyToSell = Math.min(sellQty, longLot.quantity);

                        const costOfGoodsSold = qtyToSell * longLot.pricePerShareTWD;
                        const proceedsFromSale = qtyToSell * sellPricePerShareTWD;
                        const realizedPL = proceedsFromSale - costOfGoodsSold;

                        totalRealizedPL += realizedPL;
                        pf[sym].realizedPLTWD += realizedPL;

                        longLot.quantity -= qtyToSell;
                        sellQty -= qtyToSell;

                        if (longLot.quantity < 1e-9) {
                            pf[sym].lots.shift();
                        }
                    }

                    if (sellQty > 1e-9) {
                        pf[sym].lots.push({
                            quantity: -sellQty,
                            pricePerShareOriginal: e.price,
                            pricePerShareTWD: sellPricePerShareTWD,
                            date: toDate(e.date)
                        });
                    }
                }
                break;
            }
            case "split": {
                pf[sym].lots.forEach(l => {
                    l.quantity *= e.ratio;
                    l.pricePerShareTWD /= e.ratio;
                    l.pricePerShareOriginal /= e.ratio;
                });
                break;
            }
            case "confirmed_dividend": {
                const currentQty = pf[sym].lots.reduce((s, l) => s + l.quantity, 0);
                const fx = findFxRate(market, e.currency, toDate(e.date));
                const divTWD = e.amount * (e.currency === "TWD" ? 1 : fx);
                
                if (currentQty >= 0) {
                    totalRealizedPL += divTWD;
                    pf[sym].realizedPLTWD += divTWD;
                } else {
                    totalRealizedPL -= divTWD;
                    pf[sym].realizedPLTWD -= divTWD;
                }
                break;
            }
            case "implicit_dividend": {
                const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market);
                const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
                if (shares < -1e-9) {
                     const currency = stateOnDate[sym]?.currency || 'USD';
                     const fx = findFxRate(market, currency, toDate(e.date));
                     const divTWD = e.amount_per_share * (1 - (isTwStock(sym) ? 0.0 : 0.30)) * Math.abs(shares) * (currency === "TWD" ? 1 : fx);
                     totalRealizedPL -= divTWD;
                     pf[sym].realizedPLTWD -= divTWD;
                } else if (shares > 1e-9) {
                    const currency = stateOnDate[sym]?.currency || 'USD';
                    const fx = findFxRate(market, currency, toDate(e.date));
                    const divTWD = e.amount_per_share * (1 - (isTwStock(sym) ? 0.0 : 0.30)) * shares * (currency === "TWD" ? 1 : fx);
                    totalRealizedPL += divTWD;
                    pf[sym].realizedPLTWD += divTWD;
                }
                break;
            }
        }
    }

    const { holdingsToUpdate } = calculateFinalHoldings(pf, market, evts);
    const xirrFlows = createCashflowsForXirr(evts, holdingsToUpdate, market);
    const xirr = calculateXIRR(xirrFlows);

    const totalUnrealizedPL = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.unrealizedPLTWD, 0);
    const totalProfitAndLoss = totalRealizedPL + totalUnrealizedPL;
    const totalInvestedCost = totalBuyCostTWD;
    
    const overallReturnRate = totalInvestedCost > 0 ? (totalProfitAndLoss / totalInvestedCost) * 100 : 0;

    return { holdings: { holdingsToUpdate }, totalRealizedPL, xirr, overallReturnRate };
}


// =========================================================================================
// == [新增] 移植自 back_test 專案的核心回測績效指標計算函式
// =========================================================================================
/**
 * 根據時間序列的淨值歷史，計算詳細的績效指標 (CAGR, MDD, Volatility, Sharpe, etc.)
 * @param {Object} portfolioHistory - { 'YYYY-MM-DD': value, ... } 格式的投資組合淨值歷史
 * @param {Object} benchmarkHistory - { 'YYYY-MM-DD': value, ... } 格式的比較基準淨值歷史
 * @param {number} riskFreeRate - 無風險利率 (年化)，預設為 0
 * @returns {Object} - 包含所有績效指標的物件
 */
function calculatePerformanceMetrics(portfolioHistory, benchmarkHistory = null, riskFreeRate = 0.0) {
    const historyEntries = Object.entries(portfolioHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    if (historyEntries.length < 2) {
        return { cagr: 0, mdd: 0, volatility: 0, sharpe_ratio: 0, sortino_ratio: 0, beta: null, alpha: null };
    }

    // --- 準備基礎數據 ---
    const values = historyEntries.map(entry => entry[1]);
    const dates = historyEntries.map(entry => new Date(entry[0]));
    const startValue = values[0];
    const endValue = values[values.length - 1];

    if (startValue < 1e-9) {
        return { cagr: 0, mdd: -1, volatility: 0, sharpe_ratio: 0, sortino_ratio: 0, beta: null, alpha: null };
    }

    // --- 計算日報酬率 (Daily Returns) ---
    const dailyReturns = [];
    for (let i = 1; i < values.length; i++) {
        if (values[i-1] > 1e-9) {
            dailyReturns.push((values[i] / values[i-1]) - 1);
        } else {
            dailyReturns.push(0);
        }
    }
    
    if (dailyReturns.length < 2) {
         return { cagr: 0, mdd: 0, volatility: 0, sharpe_ratio: 0, sortino_ratio: 0, beta: null, alpha: null };
    }

    // --- 計算 CAGR (年化複合成長率) ---
    const years = (dates[dates.length - 1] - dates[0]) / (365.25 * 24 * 60 * 60 * 1000);
    const cagr = years > 0 ? (endValue / startValue) ** (1 / years) - 1 : 0;

    // --- 計算 MDD (最大回撤) ---
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const value of values) {
        if (value > peak) peak = value;
        const drawdown = (peak > 1e-9) ? (value - peak) / peak : 0;
        if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    }

    // --- 計算 Volatility (年化波動率) ---
    const meanReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
    const squaredDiffs = dailyReturns.map(r => (r - meanReturn) ** 2);
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / (dailyReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    const volatility = stdDev * Math.sqrt(252); // 假設一年有 252 個交易日

    // --- 計算 Sharpe Ratio (夏普比率) ---
    const annualizedExcessReturn = cagr - riskFreeRate;
    const sharpe_ratio = (volatility > 1e-9) ? annualizedExcessReturn / volatility : 0;

    // --- 計算 Sortino Ratio (索提諾比率) ---
    const dailyRiskFreeRate = (1 + riskFreeRate) ** (1 / 252) - 1;
    const downsideReturns = dailyReturns.map(r => Math.min(0, r - dailyRiskFreeRate));
    const downsideVariance = downsideReturns.reduce((sum, r) => sum + r**2, 0) / downsideReturns.length;
    const downsideStdDev = Math.sqrt(downsideVariance) * Math.sqrt(252);
    const sortino_ratio = (downsideStdDev > 1e-9) ? annualizedExcessReturn / downsideStdDev : 0;

    // --- 計算 Alpha 和 Beta ---
    let alpha = null, beta = null;
    if (benchmarkHistory) {
        const benchEntries = Object.entries(benchmarkHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
        const benchMap = new Map(benchEntries);
        const alignedPortfolioReturns = [];
        const alignedBenchmarkReturns = [];

        let lastBenchValue = null;
        for (let i = 1; i < historyEntries.length; i++) {
            const currentDateStr = historyEntries[i][0];
            const prevDateStr = historyEntries[i-1][0];
            const currentBenchValue = benchMap.get(currentDateStr);
            const prevBenchValue = benchMap.get(prevDateStr) || lastBenchValue;

            if (currentBenchValue !== undefined && prevBenchValue !== undefined && prevBenchValue > 1e-9) {
                alignedPortfolioReturns.push(dailyReturns[i-1]);
                alignedBenchmarkReturns.push((currentBenchValue / prevBenchValue) - 1);
            }
            if (currentBenchValue !== undefined) {
                 lastBenchValue = currentBenchValue;
            }
        }

        if (alignedPortfolioReturns.length > 1) {
            const n = alignedPortfolioReturns.length;
            const meanP = alignedPortfolioReturns.reduce((s, v) => s + v, 0) / n;
            const meanB = alignedBenchmarkReturns.reduce((s, v) => s + v, 0) / n;
            
            let cov = 0, varB = 0;
            for (let i = 0; i < n; i++) {
                cov += (alignedPortfolioReturns[i] - meanP) * (alignedBenchmarkReturns[i] - meanB);
                varB += (alignedBenchmarkReturns[i] - meanB) ** 2;
            }
            cov /= (n - 1);
            varB /= (n - 1);
            
            beta = (varB > 1e-9) ? cov / varB : 0;

            const benchStartValue = benchEntries[0][1];
            const benchEndValue = benchEntries[benchEntries.length - 1][1];
            const benchCagr = years > 0 ? (benchEndValue / benchStartValue) ** (1 / years) - 1 : 0;
            
            const expectedReturn = riskFreeRate + beta * (benchCagr - riskFreeRate);
            alpha = cagr - expectedReturn;
        }
    }

    const sanitize = (val) => (val !== null && isFinite(val) ? val : null);

    return {
        cagr: sanitize(cagr),
        mdd: sanitize(maxDrawdown),
        volatility: sanitize(volatility),
        sharpe_ratio: sanitize(sharpe_ratio),
        sortino_ratio: sanitize(sortino_ratio),
        beta: sanitize(beta),
        alpha: sanitize(alpha)
    };
}


module.exports = {
    calculateTwrHistory,
    calculateFinalHoldings,
    createCashflowsForXirr,
    calculateXIRR,
    calculateDailyCashflows,
    calculateCoreMetrics,
    calculatePerformanceMetrics // [新增導出]
};
