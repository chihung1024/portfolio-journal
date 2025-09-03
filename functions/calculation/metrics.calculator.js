// =========================================================================================
// == 核心指標計算模組 (metrics.calculator.js) - v4.0 (Unified Data Source)
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


// ========================= 【核心修改 - 開始】 =========================
/**
 * 【v4.0 - FINAL】計算最終持股狀態，包含每日損益。
 * 此版本採用統一數據源策略，直接從 `fullHistory` 中讀取前一日市值，
 * 確保與圖表計算口徑完全一致。
 * @param {object} pf - 計算週期結束時的投資組合狀態物件
 * @param {object} market - 市場數據物件
 * @param {Array} allEvts - 完整的事件列表
 * @param {object} fullHistory - 【新增】完整的、每日市值歷史紀錄
 * @param {object} dailyCashflows - 【新增】每日的現金流紀錄
 * @returns {{holdingsToUpdate: object}} - 包含更新後持股的物件
 */
function calculateFinalHoldings(pf, market, allEvts, fullHistory, dailyCashflows) {
    const holdingsToUpdate = {};
    const sortedDates = Object.keys(fullHistory).sort();
    if (sortedDates.length === 0) {
        return { holdingsToUpdate };
    }

    // 1. 確定最新日期和前一天的日期
    const latestDateStr = sortedDates[sortedDates.length - 1];
    const previousDateStr = sortedDates.length > 1 ? sortedDates[sortedDates.length - 2] : null;

    // 2. 從 `fullHistory` 中讀取準確的、已計算好的市值
    const endingMarketValueTWD_Total = fullHistory[latestDateStr] || 0;
    const beginningMarketValueTWD_Total = previousDateStr ? fullHistory[previousDateStr] : 0;
    
    // 3. 從 `dailyCashflows` 中讀取當天的總現金流
    const dailyCashFlowTWD_Total = dailyCashflows[latestDateStr] || 0;

    // 4. 計算總的當日損益，這個數字將是所有個股損益的總和
    const totalDailyPL = endingMarketValueTWD_Total - beginningMarketValueTWD_Total - dailyCashFlowTWD_Total;
    
    // 5. 計算總報酬率，用於分配個股損益
    let totalDailyReturnPercent = 0;
    const denominator = beginningMarketValueTWD_Total + dailyCashFlowTWD_Total;
    if (Math.abs(denominator) > 1e-9) {
        totalDailyReturnPercent = totalDailyPL / denominator;
    }

    for (const sym in pf) {
        const h = pf[sym];
        const qty_end_of_day = h.lots.reduce((s, l) => s + l.quantity, 0);

        if (Math.abs(qty_end_of_day) < 1e-9) continue;
        
        const totCostTWD = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareTWD, 0);
        const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0);

        const priceInfo = findNearest(market[sym]?.prices, new Date(latestDateStr));
        const unadjustedPrice = priceInfo ? priceInfo.value : 0;
        
        const fx = findFxRate(market, h.currency, new Date(latestDateStr));
        const marketValueTWD = qty_end_of_day * unadjustedPrice * (h.currency === "TWD" ? 1 : fx);

        // 6. 將總損益按各股的「昨日市值 + 當日現金流」貢獻比例，分配給每一檔股票
        // (找到昨日的持股狀態)
        const previousState = getPortfolioStateOnDate(allEvts, new Date(previousDateStr || '1970-01-01'), market);
        const qty_start_of_day = previousState[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
        
        // (找到昨日的價格和匯率)
        const priceInfoBefore = previousDateStr ? findNearest(market[sym]?.prices, new Date(previousDateStr)) : null;
        const priceBefore = priceInfoBefore ? priceInfoBefore.value : 0;
        const fxBefore = previousDateStr ? findFxRate(market, h.currency, new Date(previousDateStr)) : 1;
        
        const beginningMarketValueTWD_Stock = qty_start_of_day * priceBefore * (h.currency === "TWD" ? 1 : fxBefore);

        // (找到當日的現金流)
        const todaysTransactions = allEvts.filter(e =>
            e.eventType === 'transaction' && e.symbol.toUpperCase() === sym && e.date.split('T')[0] === latestDateStr
        );
        const dailyCashFlowTWD_Stock = todaysTransactions.reduce((sum, tx) => {
            const txFx = findFxRate(market, tx.currency, toDate(tx.date));
            const costTWD = getTotalCost(tx) * (tx.currency === "TWD" ? 1 : txFx);
            return sum + (tx.type === 'buy' ? costTWD : -costTWD);
        }, 0);

        const stock_denominator = beginningMarketValueTWD_Stock + dailyCashFlowTWD_Stock;
        
        // 7. 計算個股的最終損益和報酬率
        const daily_pl_twd = stock_denominator * totalDailyReturnPercent;
        let daily_change_percent = 0;
        if (Math.abs(stock_denominator) > 1e-9) {
            daily_change_percent = (daily_pl_twd / stock_denominator) * 100;
        }

        holdingsToUpdate[sym] = {
            symbol: sym,
            quantity: qty_end_of_day,
            currency: h.currency,
            avgCostOriginal: totCostOrg !== 0 ? Math.abs(totCostOrg / qty_end_of_day) : 0,
            totalCostTWD: totCostTWD,
            currentPriceOriginal: unadjustedPrice,
            marketValueTWD: marketValueTWD,
            unrealizedPLTWD: marketValueTWD - totCostTWD,
            realizedPLTWD: h.realizedPLTWD,
            returnRate: totCostTWD !== 0 ? ((marketValueTWD - totCostTWD) / Math.abs(totCostTWD)) * 100 : 0,
            daily_change_percent: daily_change_percent,
            daily_pl_twd: daily_pl_twd
        };
    }
    return { holdingsToUpdate };
}
// ========================= 【核心修改 - 結束】 =========================


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

function calculateCoreMetrics(evts, market, fullHistory, dailyCashflows) {
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

    const { holdingsToUpdate } = calculateFinalHoldings(pf, market, evts, fullHistory, dailyCashflows);
    const xirrFlows = createCashflowsForXirr(evts, holdingsToUpdate, market);
    const xirr = calculateXIRR(xirrFlows);

    const totalUnrealizedPL = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.unrealizedPLTWD, 0);
    const totalProfitAndLoss = totalRealizedPL + totalUnrealizedPL;
    const totalInvestedCost = totalBuyCostTWD;
    
    const overallReturnRate = totalInvestedCost > 0 ? (totalProfitAndLoss / totalInvestedCost) * 100 : 0;

    return { holdings: { holdingsToUpdate }, totalRealizedPL, xirr, overallReturnRate };
}

module.exports = {
    calculateTwrHistory,
    calculateFinalHoldings,
    createCashflowsForXirr,
    calculateXIRR,
    calculateDailyCashflows,
    calculateCoreMetrics
};
