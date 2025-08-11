// =========================================================================================
// == 核心指標計算模組 (metrics.calculator.js)
// == 職責：提供所有核心財務指標的純計算函式，如 TWR, XIRR, PL 等。
// =========================================================================================

const { toDate, isTwStock, getTotalCost, findNearest, findFxRate } = require('./helpers');
const { getPortfolioStateOnDate } = require('./state.calculator');

/**
 * 計算時間加權報酬率 (TWR) 和 Benchmark 報酬率的歷史數據
 */
function calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, startDate, dailyCashflows, log = console.log) {
    const dates = Object.keys(dailyPortfolioValues).sort();
    if (!startDate || dates.length === 0) return { twrHistory: {}, benchmarkHistory: {} };

    const upperBenchmarkSymbol = benchmarkSymbol.toUpperCase();
    const benchmarkPrices = market[upperBenchmarkSymbol]?.prices || {};
    if (Object.keys(benchmarkPrices).length === 0) {
        log(`TWR_CALC_WARN: Benchmark ${upperBenchmarkSymbol} a歷史價格，將跳過計算。`);
        return { twrHistory: {}, benchmarkHistory: {} };
    }
    
    const benchmarkCurrency = isTwStock(upperBenchmarkSymbol) ? "TWD" : "USD";
    const startFxRate = findFxRate(market, benchmarkCurrency, startDate);
    const benchmarkStartPriceOriginal = findNearest(benchmarkPrices, startDate);

    if (!benchmarkStartPriceOriginal) {
        log(`TWR_CALC_FAIL: Cannot find start price for benchmark ${upperBenchmarkSymbol}.`);
        return { twrHistory: {}, benchmarkHistory: {} };
    }
    const benchmarkStartPriceTWD = benchmarkStartPriceOriginal * startFxRate;

    const twrHistory = {};
    const benchmarkHistory = {};
    let cumulativeHpr = 1;
    let lastMarketValue = 0;

    for (const dateStr of dates) {
        const MVE = dailyPortfolioValues[dateStr];
        const CF = dailyCashflows[dateStr] || 0; // TWR 的現金流定義相反，但在傳入前已處理
        const denominator = lastMarketValue + CF;

        if (denominator !== 0) {
            cumulativeHpr *= MVE / denominator;
        }
        twrHistory[dateStr] = (cumulativeHpr - 1) * 100;
        lastMarketValue = MVE;

        const currentBenchPriceOriginal = findNearest(benchmarkPrices, new Date(dateStr));
        if (currentBenchPriceOriginal && benchmarkStartPriceTWD > 0) {
            const currentFxRate = findFxRate(market, benchmarkCurrency, new Date(dateStr));
            benchmarkHistory[dateStr] = ((currentBenchPriceOriginal * currentFxRate / benchmarkStartPriceTWD) - 1) * 100;
        }
    }
    return { twrHistory, benchmarkHistory };
}

/**
 * 計算最終持股的各項指標（用於更新 holdings 表）
 */
function calculateFinalHoldings(pf, market, allEvts) {
    const holdingsToUpdate = {};
    const today = new Date();
    for (const sym in pf) {
        const h = pf[sym];
        const qty = h.lots.reduce((s, l) => s + l.quantity, 0);
        if (qty > 1e-9) {
            const totCostTWD = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareTWD, 0);
            const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0);
            const curPrice = findNearest(market[sym]?.prices || {}, today);
            const fx = findFxRate(market, h.currency, today);
            const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym.toUpperCase() && toDate(e.date) > today);
            const unadjustedPrice = (curPrice ?? 0) * futureSplits.reduce((acc, split) => acc * split.ratio, 1);
            const mktVal = qty * unadjustedPrice * (h.currency === "TWD" ? 1 : fx);

            holdingsToUpdate[sym] = {
                symbol: sym,
                quantity: qty,
                currency: h.currency,
                avgCostOriginal: totCostOrg > 0 ? totCostOrg / qty : 0,
                totalCostTWD: totCostTWD,
                currentPriceOriginal: unadjustedPrice,
                marketValueTWD: mktVal,
                unrealizedPLTWD: mktVal - totCostTWD,
                realizedPLTWD: h.realizedPLTWD,
                returnRate: totCostTWD > 0 ? ((mktVal - totCostTWD) / totCostTWD) * 100 : 0
            };
        }
    }
    return { holdingsToUpdate };
}

/**
 * 準備用於計算 XIRR 的現金流列表
 */
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
    if (totalMarketValue > 0) {
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

/**
 * 計算 XIRR (內部報酬率)
 */
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
        if (1 + guess <= 0) {
            guess /= -2;
            continue;
        }
        npv = amounts.reduce((sum, amount, j) => sum + amount / Math.pow(1 + guess, years[j]), 0);
        if (Math.abs(npv) < 1e-6) return guess;
        const derivative = amounts.reduce((sum, amount, j) => sum - years[j] * amount / Math.pow(1 + guess, years[j] + 1), 0);
        if (Math.abs(derivative) < 1e-9) break;
        guess -= npv / derivative;
    }
    return (npv && Math.abs(npv) < 1e-6) ? guess : null;
}

/**
 * 計算每日現金流 (用於計算 TWR 和淨利)
 */
function calculateDailyCashflows(evts, market) {
    return evts.reduce((acc, e) => {
        const dateStr = toDate(e.date).toISOString().split('T')[0];
        let flow = 0;
        if (e.eventType === 'transaction') {
            const currency = e.currency || 'USD';
            const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, toDate(e.date));
            // 買入為正現金流(投入)，賣出為負現金流(抽離) -> 為了計算淨利
            // 注意: TWR的現金流定義與此相反，我們會在TWR函式中處理
            flow = (e.type === 'buy' ? 1 : -1) * getTotalCost(e) * (currency === 'TWD' ? 1 : fx);
        } else if (e.eventType === 'confirmed_dividend' || e.eventType === 'implicit_dividend') {
            // 股息視為現金抽離 (負向現金流)
            let dividendAmountTWD = 0;
            if (e.eventType === 'confirmed_dividend') {
                const fx = findFxRate(market, e.currency, toDate(e.date));
                dividendAmountTWD = e.amount * (e.currency === 'TWD' ? 1 : fx);
            } else { // implicit_dividend
                const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market);
                const shares = stateOnDate[e.symbol.toUpperCase()]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0;
                if (shares > 0) {
                    const currency = stateOnDate[e.symbol.toUpperCase()]?.currency || 'USD';
                    const fx = findFxRate(market, currency, toDate(e.date));
                    const postTaxAmount = e.amount_per_share * (1 - (isTwStock(e.symbol) ? 0.0 : 0.30));
                    dividendAmountTWD = postTaxAmount * shares * fx;
                }
            }
            flow = -1 * dividendAmountTWD;
        }

        if (flow !== 0) acc[dateStr] = (acc[dateStr] || 0) + flow;
        return acc;
    }, {});
}

/**
 * 計算最終的核心匯總指標 (已實現/未實現損益, 總體報酬率等)
 */
function calculateCoreMetrics(evts, market) {
    const pf = {}; // 用於追蹤每個股票的 FIFO 成本和已實現損益
    let totalRealizedPL = 0;

    for (const e of evts) {
        const sym = e.symbol.toUpperCase();
        if (!pf[sym]) {
            pf[sym] = { lots: [], currency: e.currency || "USD", realizedPLTWD: 0, realizedCostTWD: 0 };
        }
        switch (e.eventType) {
            case "transaction": {
                const fx = (e.exchangeRate && e.currency !== 'TWD') ? e.exchangeRate : findFxRate(market, e.currency, toDate(e.date));

                if (e.type === "buy") {
                    const totalBuyCostTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);
                    pf[sym].lots.push({ 
                        quantity: e.quantity, 
                        pricePerShareOriginal: e.price, 
                        pricePerShareTWD: totalBuyCostTWD / (e.quantity || 1), 
                        date: toDate(e.date) 
                    });
                } else { // sell
                    const proceedsTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx); // 明確定義為「收入」
                    let sellQty = e.quantity;
                    let costOfGoodsSoldTWD = 0;

                    // FIFO 邏輯來計算已售出股份的原始成本
                    while (sellQty > 0 && pf[sym].lots.length > 0) {
                        const lot = pf[sym].lots[0];
                        const qtyToSell = Math.min(sellQty, lot.quantity);
                        
                        costOfGoodsSoldTWD += qtyToSell * lot.pricePerShareTWD;
                        
                        lot.quantity -= qtyToSell;
                        sellQty -= qtyToSell;

                        if (lot.quantity < 1e-9) {
                            pf[sym].lots.shift();
                        }
                    }

                    // 計算本次交易的「已實現損益」 (利潤或虧損)
                    const realizedPL = proceedsTWD - costOfGoodsSoldTWD;
                    
                    // 將本次的「已實現損益」累加到總額和該股票的累計額中
                    totalRealizedPL += realizedPL;
                    pf[sym].realizedPLTWD += realizedPL;

                    // 將本次賣出股票的「成本」累加到已實現成本中 (用於計算總投資成本)
                    pf[sym].realizedCostTWD += costOfGoodsSoldTWD;
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
                const fx = findFxRate(market, e.currency, toDate(e.date));
                const divTWD = e.amount * (e.currency === "TWD" ? 1 : fx);
                totalRealizedPL += divTWD;
                pf[sym].realizedPLTWD += divTWD;
                break;
            }
            case "implicit_dividend": {
                const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market);
                const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
                if (shares > 0) {
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
    const totalInvestedCost = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.totalCostTWD, 0) + Object.values(pf).reduce((sum, p) => sum + p.realizedCostTWD, 0);
    const totalReturnValue = totalRealizedPL + totalUnrealizedPL;
    const overallReturnRate = totalInvestedCost > 0 ? (totalReturnValue / totalInvestedCost) * 100 : 0;

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
