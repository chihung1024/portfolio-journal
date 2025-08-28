// =========================================================================================
// == 核心指標計算模組 (metrics.calculator.js) v4.1 - Detailed FIFO Closed Lot Tracking
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
    // ========================= 【核心修改 - 開始】 =========================
    const closedLots = []; // 新增：用於儲存詳細的已平倉紀錄
    // ========================= 【核心修改 - 結束】 =========================

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

                        // 【新增】記錄詳細的空頭回補平倉紀錄
                        closedLots.push({
                            symbol: sym,
                            buyDate: toDate(e.date).toISOString().split('T')[0],
                            sellDate: shortLot.date.toISOString().split('T')[0], // 賣出日期在前
                            quantity: qtyToCover,
                            buyPricePerShareTWD: buyPricePerShareTWD,
                            sellPricePerShareTWD: shortLot.pricePerShareTWD,
                            realizedPLTWD: realizedPL,
                            currency: pf[sym].currency,
                            type: 'short_cover'
                        });
                        
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

                        // ========================= 【核心修改 - 開始】 =========================
                        // 【新增】記錄詳細的多頭平倉紀錄
                        closedLots.push({
                            symbol: sym,
                            buyDate: longLot.date.toISOString().split('T')[0],
                            sellDate: toDate(e.date).toISOString().split('T')[0],
                            quantity: qtyToSell,
                            buyPricePerShareTWD: longLot.pricePerShareTWD,
                            sellPricePerShareTWD: sellPricePerShareTWD,
                            realizedPLTWD: realizedPL,
                            currency: pf[sym].currency,
                            type: 'long_sell'
                        });
                        // ========================= 【核心修改 - 結束】 =========================

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
    
    // ========================= 【核心修改 - 開始】 =========================
    // 舊的 closedPositions 邏輯已移除，直接回傳新的 closedLots 陣列
    return { 
        holdings: { holdingsToUpdate }, 
        closedLots: closedLots.sort((a,b) => new Date(b.sellDate) - new Date(a.sellDate)), // 按賣出日期降序排列
        totalRealizedPL, 
        xirr, 
        overallReturnRate 
    };
    // ========================= 【核心修改 - 結束】 =========================
}

module.exports = {
    calculateTwrHistory,
    calculateFinalHoldings,
    createCashflowsForXirr,
    calculateXIRR,
    calculateDailyCashflows,
    calculateCoreMetrics
};
