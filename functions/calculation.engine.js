// =========================================================================================
// == 核心計算引擎 (v4.0.0 - 混合計算最終版)
// =========================================================================================

const yahooFinance = require("yahoo-finance2").default;
const { d1Client } = require('./d1.client');

// --- 股息快取模組 ---
async function calculateAndCachePendingDividends(uid, txs, userDividends) {
    console.log(`[${uid}] 開始計算並快取待確認股息...`);
    await d1Client.batch([{ sql: 'DELETE FROM user_pending_dividends WHERE uid = ?', params: [uid] }]);
    if (!txs || txs.length === 0) {
        console.log(`[${uid}] 使用者無交易紀錄，無需快取股息。`);
        return;
    }
    const allMarketDividends = await d1Client.query('SELECT * FROM dividend_history ORDER BY date ASC');
    if (!allMarketDividends || allMarketDividends.length === 0) {
        console.log(`[${uid}] 無市場股息資料，無需快取。`);
        return;
    }
    const confirmedKeys = new Set(userDividends.map(d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`));
    const holdings = {};
    let txIndex = 0;
    const pendingDividends = [];
    const uniqueSymbolsInTxs = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
    const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;

    allMarketDividends.forEach(histDiv => {
        const divSymbol = histDiv.symbol.toUpperCase();
        if (!uniqueSymbolsInTxs.includes(divSymbol)) return;
        const exDateStr = histDiv.date.split('T')[0];
        if (confirmedKeys.has(`${divSymbol}_${exDateStr}`)) return;
        const exDateMinusOne = new Date(exDateStr);
        exDateMinusOne.setDate(exDateMinusOne.getDate() - 1);
        while(txIndex < txs.length && new Date(txs[txIndex].date) <= exDateMinusOne) {
            const tx = txs[txIndex];
            holdings[tx.symbol.toUpperCase()] = (holdings[tx.symbol.toUpperCase()] || 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity);
            txIndex++;
        }
        const quantity = holdings[divSymbol] || 0;
        if (quantity > 0) {
            const currency = txs.find(t => t.symbol.toUpperCase() === divSymbol)?.currency || (isTwStock(divSymbol) ? 'TWD' : 'USD');
            pendingDividends.push({
                symbol: divSymbol, ex_dividend_date: exDateStr, amount_per_share: histDiv.dividend,
                quantity_at_ex_date: quantity, currency: currency
            });
        }
    });

    if (pendingDividends.length > 0) {
        const dbOps = pendingDividends.map(p => ({
            sql: `INSERT INTO user_pending_dividends (uid, symbol, ex_dividend_date, amount_per_share, quantity_at_ex_date, currency) VALUES (?, ?, ?, ?, ?, ?)`,
            params: [uid, p.symbol, p.ex_dividend_date, p.amount_per_share, p.quantity_at_ex_date, p.currency]
        }));
        await d1Client.batch(dbOps);
    }
    console.log(`[${uid}] 成功快取 ${pendingDividends.length} 筆待確認股息。`);
}

// --- 所有核心計算與資料獲取輔助函式 ---
async function fetchAndSaveMarketDataRange(symbol, startDate, endDate) {
    try {
        const hist = await yahooFinance.historical(symbol, { period1: startDate, period2: endDate, interval: '1d', autoAdjust: false, backAdjust: false });
        if (!hist || hist.length === 0) return [];
        const dbOps = [];
        const tableName = symbol.includes("=") ? "exchange_rates" : "price_history";
        for (const item of hist) {
            const itemDate = item.date.toISOString().split('T')[0];
            if (item.close !== null && !isNaN(item.close)) {
                dbOps.push({ sql: `INSERT OR IGNORE INTO ${tableName} (symbol, date, price) VALUES (?, ?, ?)`, params: [symbol, itemDate, item.close] });
            }
            if (!symbol.includes("=") && item.dividends > 0) {
                dbOps.push({ sql: `INSERT OR IGNORE INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)`, params: [symbol, itemDate, item.dividends] });
            }
        }
        if (dbOps.length > 0) await d1Client.batch(dbOps);
        return hist;
    } catch (e) {
        console.error(`Error fetching market data for ${symbol}:`, e);
        return null;
    }
}
async function ensureDataCoverage(symbol, requiredStartDate) {
    if (!symbol || !requiredStartDate) return;
    const coverageData = await d1Client.query('SELECT earliest_date FROM market_data_coverage WHERE symbol = ?', [symbol]);
    const today = new Date().toISOString().split('T')[0];
    if (coverageData.length === 0) {
        const fetchedData = await fetchAndSaveMarketDataRange(symbol, requiredStartDate, today);
        if (fetchedData && fetchedData.length > 0) {
            const actualEarliestDate = fetchedData[0].date.toISOString().split('T')[0];
            await d1Client.query('INSERT INTO market_data_coverage (symbol, earliest_date, last_updated) VALUES (?, ?, ?)', [symbol, actualEarliestDate, today]);
        }
        return;
    }
    const currentEarliestDate = coverageData[0].earliest_date;
    if (requiredStartDate < currentEarliestDate) {
        const isFx = symbol.includes("=");
        const priceTable = isFx ? "exchange_rates" : "price_history";
        const deleteOps = [{ sql: `DELETE FROM ${priceTable} WHERE symbol = ?`, params: [symbol] }];
        if (!isFx) deleteOps.push({ sql: `DELETE FROM dividend_history WHERE symbol = ?`, params: [symbol] });
        await d1Client.batch(deleteOps);
        const fetchedData = await fetchAndSaveMarketDataRange(symbol, requiredStartDate, today);
        if (fetchedData && fetchedData.length > 0) {
            const actualEarliestDate = fetchedData[0].date.toISOString().split('T')[0];
            await d1Client.query('UPDATE market_data_coverage SET earliest_date = ?, last_updated = ? WHERE symbol = ?', [actualEarliestDate, today, symbol]);
        }
    }
}
async function ensureDataFreshness(symbols) {
    if (!symbols || symbols.length === 0) return;
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - 1);
    const targetDateStr = targetDate.toISOString().split('T')[0];
    const fetchPromises = symbols.map(async (symbol) => {
        const isFx = symbol.includes("=");
        const tableName = isFx ? "exchange_rates" : "price_history";
        const result = await d1Client.query(`SELECT MAX(date) as latest_date FROM ${tableName} WHERE symbol = ?`, [symbol]);
        const latestDateStr = result?.[0]?.latest_date?.split('T')[0];
        if (!latestDateStr || latestDateStr < targetDateStr) {
            const startDate = new Date(latestDateStr || '2000-01-01');
            startDate.setDate(startDate.getDate() + 1);
            const startDateStr = startDate.toISOString().split('T')[0];
            return fetchAndSaveMarketDataRange(symbol, startDateStr, today.toISOString().split('T')[0]);
        }
    });
    await Promise.all(fetchPromises);
}
const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
async function getMarketDataFromDb(txs, benchmarkSymbol) {
    const symbolsInPortfolio = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
    const currencies = [...new Set(txs.map(t => t.currency))].filter(c => c !== "TWD");
    const requiredFxSymbols = currencies.map(c => currencyToFx[c]).filter(Boolean);
    const requiredStockSymbols = [...new Set([...symbolsInPortfolio, benchmarkSymbol.toUpperCase()])].filter(Boolean);
    const promises = [];
    if (requiredStockSymbols.length > 0) {
        const p1 = requiredStockSymbols.map(() => '?').join(',');
        promises.push(d1Client.query(`SELECT symbol, date, price FROM price_history WHERE symbol IN (${p1})`, requiredStockSymbols));
        promises.push(d1Client.query(`SELECT symbol, date, dividend FROM dividend_history WHERE symbol IN (${p1})`, requiredStockSymbols));
    } else { promises.push(Promise.resolve([]), Promise.resolve([])); }
    if (requiredFxSymbols.length > 0) {
        const p2 = requiredFxSymbols.map(() => '?').join(',');
        promises.push(d1Client.query(`SELECT symbol, date, price FROM exchange_rates WHERE symbol IN (${p2})`, requiredFxSymbols));
    } else { promises.push(Promise.resolve([])); }
    const [stockPricesFlat, stockDividendsFlat, fxRatesFlat] = await Promise.all(promises);
    const allSymbols = [...requiredStockSymbols, ...requiredFxSymbols];
    const marketData = allSymbols.reduce((acc, symbol) => ({...acc, [symbol]: { prices: {}, dividends: {} }}), {});
    stockPricesFlat.forEach(row => { marketData[row.symbol].prices[row.date.split('T')[0]] = row.price; });
    stockDividendsFlat.forEach(row => { marketData[row.symbol].dividends[row.date.split('T')[0]] = row.dividend; });
    fxRatesFlat.forEach(row => { marketData[row.symbol].prices[row.date.split('T')[0]] = row.price; });
    requiredFxSymbols.forEach(fxSymbol => { if(marketData[fxSymbol]) marketData[fxSymbol].rates = marketData[fxSymbol].prices; });
    return marketData;
}
const toDate = v => { if (!v) return null; const d = v.toDate ? v.toDate() : new Date(v); if (d instanceof Date && !isNaN(d)) d.setUTCHours(0, 0, 0, 0); return d; };
const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
const getTotalCost = (tx) => (tx.totalCost != null) ? Number(tx.totalCost) : Number(tx.price || 0) * Number(tx.quantity || 0);
function findNearest(hist, date, toleranceDays = 7) { if (!hist || Object.keys(hist).length === 0) return undefined; const tgt = toDate(date); if(!tgt) return undefined; const tgtStr = tgt.toISOString().slice(0, 10); if (hist[tgtStr]) return hist[tgtStr]; for (let i = 1; i <= toleranceDays; i++) { const checkDate = new Date(tgt); checkDate.setDate(checkDate.getDate() - i); const checkDateStr = checkDate.toISOString().split('T')[0]; if (hist[checkDateStr]) return hist[checkDateStr]; } const sortedDates = Object.keys(hist).sort((a, b) => new Date(b) - new Date(a)); for (const dateStr of sortedDates) { if (dateStr <= tgtStr) return hist[dateStr]; } return undefined; }
function findFxRate(market, currency, date, tolerance = 15) { if (!currency || currency === "TWD") return 1; const fxSym = currencyToFx[currency]; if (!fxSym || !market[fxSym]) return 1; return findNearest(market[fxSym]?.rates || {}, date, tolerance) ?? 1; }
function getPortfolioStateOnDate(allEvts, targetDate, market) { const state = {}; const pastEvents = allEvts.filter(e => toDate(e.date) <= toDate(targetDate)); for (const e of pastEvents) { const sym = e.symbol.toUpperCase(); if (!state[sym]) state[sym] = { lots: [], currency: e.currency || "USD" }; if (e.eventType === 'transaction') { state[sym].currency = e.currency; if (e.type === 'buy') { const fx = findFxRate(market, e.currency, toDate(e.date)); const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx); state[sym].lots.push({ quantity: e.quantity, pricePerShareTWD: costTWD / (e.quantity || 1), pricePerShareOriginal: e.price, date: toDate(e.date) }); } else { let sellQty = e.quantity; while (sellQty > 0 && state[sym].lots.length > 0) { const lot = state[sym].lots[0]; if (lot.quantity <= sellQty) { sellQty -= lot.quantity; state[sym].lots.shift(); } else { lot.quantity -= sellQty; sellQty = 0; } } } } else if (e.eventType === 'split') { state[sym].lots.forEach(lot => { lot.quantity *= e.ratio; lot.pricePerShareTWD /= e.ratio; lot.pricePerShareOriginal /= e.ratio; }); } } return state; }
function dailyValue(state, market, date, allEvts) { return Object.keys(state).reduce((totalValue, sym) => { const s = state[sym]; const qty = s.lots.reduce((sum, lot) => sum + lot.quantity, 0); if (qty < 1e-9) return totalValue; let price = findNearest(market[sym]?.prices, date); if (price === undefined) { const yesterday = new Date(date); yesterday.setDate(yesterday.getDate() - 1); const firstLotDate = s.lots.length > 0 ? toDate(s.lots[0].date) : date; if (yesterday < firstLotDate) return totalValue; return totalValue + dailyValue({ [sym]: s }, market, yesterday, allEvts); } const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym.toUpperCase() && toDate(e.date) > toDate(date)); const adjustmentRatio = futureSplits.reduce((acc, split) => acc * split.ratio, 1); const unadjustedPrice = price * adjustmentRatio; const fx = findFxRate(market, s.currency, date); return totalValue + (qty * unadjustedPrice * (s.currency === "TWD" ? 1 : fx)); }, 0); }
function prepareEvents(txs, splits, market, userDividends) { const firstBuyDateMap = {}; txs.forEach(tx => { if (tx.type === "buy") { const sym = tx.symbol.toUpperCase(); const d = toDate(tx.date); if (!firstBuyDateMap[sym] || d < firstBuyDateMap[sym]) firstBuyDateMap[sym] = d; }}); const evts = [ ...txs.map(t => ({ ...t, eventType: "transaction" })), ...splits.map(s => ({ ...s, eventType: "split" })) ]; const confirmedDividendKeys = new Set(userDividends.map(d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`)); userDividends.forEach(ud => evts.push({ eventType: 'confirmed_dividend', date: toDate(ud.pay_date), symbol: ud.symbol.toUpperCase(), amount: ud.total_amount, currency: ud.currency })); Object.keys(market).forEach(sym => { if (market[sym]?.dividends) { Object.entries(market[sym].dividends).forEach(([dateStr, amount]) => { const dividendDate = toDate(dateStr); if (confirmedDividendKeys.has(`${sym.toUpperCase()}_${dateStr}`)) return; if (firstBuyDateMap[sym] && dividendDate >= firstBuyDateMap[sym] && amount > 0) { const payDate = new Date(dividendDate); payDate.setMonth(payDate.getMonth() + 1); evts.push({ eventType: "implicit_dividend", date: payDate, ex_date: dividendDate, symbol: sym.toUpperCase(), amount_per_share: amount }); } }); } }); evts.sort((a, b) => toDate(a.date) - toDate(b.date)); const firstTx = evts.find(e => e.eventType === 'transaction'); return { evts, firstBuyDate: firstTx ? toDate(firstTx.date) : null }; }

function calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, startDate, dailyCashflows, log = console.log) { const dates = Object.keys(dailyPortfolioValues).sort(); if (!startDate || dates.length === 0) return { twrHistory: {}, benchmarkHistory: {} }; const upperBenchmarkSymbol = benchmarkSymbol.toUpperCase(); const benchmarkPrices = market[upperBenchmarkSymbol]?.prices || {}; const benchmarkCurrency = isTwStock(upperBenchmarkSymbol) ? "TWD" : "USD"; const startFxRate = findFxRate(market, benchmarkCurrency, startDate); const benchmarkStartPriceOriginal = findNearest(benchmarkPrices, startDate); if (!benchmarkStartPriceOriginal) { log(`TWR_CALC_FAIL: Cannot find start price for benchmark ${upperBenchmarkSymbol}.`); return { twrHistory: {}, benchmarkHistory: {} }; } const benchmarkStartPriceTWD = benchmarkStartPriceOriginal * startFxRate; 
    // 【修改】直接使用傳入的 dailyCashflows，並因為TWR公式定義，將現金流正負號反轉
    const twrCashflows = Object.entries(dailyCashflows).reduce((acc, [date, flow]) => {
        acc[date] = -flow; // TWR 的公式中，投入(buy)為正，提出(sell/dividend)為負
        return acc;
    }, {});
    const twrHistory = {}, benchmarkHistory = {}; let cumulativeHpr = 1, lastMarketValue = 0; for (const dateStr of dates) { const MVE = dailyPortfolioValues[dateStr]; const CF = twrCashflows[dateStr] || 0; const denominator = lastMarketValue + CF; if (denominator !== 0) cumulativeHpr *= MVE / denominator; twrHistory[dateStr] = (cumulativeHpr - 1) * 100; lastMarketValue = MVE; const currentBenchPriceOriginal = findNearest(benchmarkPrices, new Date(dateStr)); if (currentBenchPriceOriginal && benchmarkStartPriceTWD > 0) { const currentFxRate = findFxRate(market, benchmarkCurrency, new Date(dateStr)); benchmarkHistory[dateStr] = ((currentBenchPriceOriginal * currentFxRate / benchmarkStartPriceTWD) - 1) * 100; } } return { twrHistory, benchmarkHistory }; }

function calculateFinalHoldings(pf, market, allEvts) { const holdingsToUpdate = {}; const today = new Date(); for (const sym in pf) { const h = pf[sym]; const qty = h.lots.reduce((s, l) => s + l.quantity, 0); if (qty > 1e-9) { const totCostTWD = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareTWD, 0); const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0); const curPrice = findNearest(market[sym]?.prices || {}, today); const fx = findFxRate(market, h.currency, today); const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym.toUpperCase() && toDate(e.date) > today); const unadjustedPrice = (curPrice ?? 0) * futureSplits.reduce((acc, split) => acc * split.ratio, 1); const mktVal = qty * unadjustedPrice * (h.currency === "TWD" ? 1 : fx); holdingsToUpdate[sym] = { symbol: sym, quantity: qty, currency: h.currency, avgCostOriginal: totCostOrg > 0 ? totCostOrg / qty : 0, totalCostTWD: totCostTWD, currentPriceOriginal: unadjustedPrice, marketValueTWD: mktVal, unrealizedPLTWD: mktVal - totCostTWD, realizedPLTWD: h.realizedPLTWD, returnRate: totCostTWD > 0 ? ((mktVal - totCostTWD) / totCostTWD) * 100 : 0 }; } } return { holdingsToUpdate }; }
function createCashflowsForXirr(evts, holdings, market) { const flows = []; evts.forEach(e => { let amt = 0, flowDate = toDate(e.date); if (e.eventType === "transaction") { const currency = e.currency || 'USD'; const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, flowDate); amt = (e.type === "buy" ? -getTotalCost(e) : getTotalCost(e)) * (currency === 'TWD' ? 1 : fx); } else if (e.eventType === "confirmed_dividend") { const fx = findFxRate(market, e.currency, flowDate); amt = e.amount * (e.currency === 'TWD' ? 1 : fx); } else if (e.eventType === "implicit_dividend") { const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market); const sym = e.symbol.toUpperCase(); const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0; if (shares > 0) { const currency = stateOnDate[sym]?.currency || 'USD'; const fx = findFxRate(market, currency, flowDate); const postTaxAmount = e.amount_per_share * (1 - (isTwStock(sym) ? 0.0 : 0.30)); amt = postTaxAmount * shares * (currency === "TWD" ? 1 : fx); } } if (Math.abs(amt) > 1e-6) flows.push({ date: flowDate, amount: amt }); }); const totalMarketValue = Object.values(holdings).reduce((s, h) => s + h.marketValueTWD, 0); if (totalMarketValue > 0) flows.push({ date: new Date(), amount: totalMarketValue }); const combined = flows.reduce((acc, flow) => { const dateStr = flow.date.toISOString().slice(0, 10); acc[dateStr] = (acc[dateStr] || 0) + flow.amount; return acc; }, {}); return Object.entries(combined).filter(([, amount]) => Math.abs(amount) > 1e-6).map(([date, amount]) => ({ date: new Date(date), amount })).sort((a, b) => a.date - b.date); }
function calculateXIRR(flows) { if (flows.length < 2) return null; const amounts = flows.map(f => f.amount); if (!amounts.some(v => v < 0) || !amounts.some(v => v > 0)) return null; const dates = flows.map(f => f.date); const epoch = dates[0].getTime(); const years = dates.map(d => (d.getTime() - epoch) / (365.25 * 24 * 60 * 60 * 1000)); let guess = 0.1, npv; for (let i = 0; i < 50; i++) { if (1 + guess <= 0) { guess /= -2; continue; } npv = amounts.reduce((sum, amount, j) => sum + amount / Math.pow(1 + guess, years[j]), 0); if (Math.abs(npv) < 1e-6) return guess; const derivative = amounts.reduce((sum, amount, j) => sum - years[j] * amount / Math.pow(1 + guess, years[j] + 1), 0); if (Math.abs(derivative) < 1e-9) break; guess -= npv / derivative; } return (npv && Math.abs(npv) < 1e-6) ? guess : null; }

// 【新增】抽離出來的每日現金流計算輔助函式
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

function calculateCoreMetrics(evts, market) { const pf = {}; let totalRealizedPL = 0; for (const e of evts) { const sym = e.symbol.toUpperCase(); if (!pf[sym]) pf[sym] = { lots: [], currency: e.currency || "USD", realizedPLTWD: 0, realizedCostTWD: 0 }; switch (e.eventType) { case "transaction": { const fx = (e.exchangeRate && e.currency !== 'TWD') ? e.exchangeRate : findFxRate(market, e.currency, toDate(e.date)); const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx); if (e.type === "buy") { pf[sym].lots.push({ quantity: e.quantity, pricePerShareOriginal: e.price, pricePerShareTWD: costTWD / (e.quantity || 1), date: toDate(e.date) }); } else { let sellQty = e.quantity; let costOfGoodsSoldTWD = 0; while (sellQty > 0 && pf[sym].lots.length > 0) { const lot = pf[sym].lots[0]; const qtyToSell = Math.min(sellQty, lot.quantity); costOfGoodsSoldTWD += qtyToSell * lot.pricePerShareTWD; lot.quantity -= qtyToSell; sellQty -= qtyToSell; if (lot.quantity < 1e-9) pf[sym].lots.shift(); } const realized = costTWD - costOfGoodsSoldTWD; totalRealizedPL += realized; pf[sym].realizedCostTWD += costOfGoodsSoldTWD; pf[sym].realizedPLTWD += realized; } break; } case "split": { pf[sym].lots.forEach(l => { l.quantity *= e.ratio; l.pricePerShareTWD /= e.ratio; l.pricePerShareOriginal /= e.ratio; }); break; } case "confirmed_dividend": { const fx = findFxRate(market, e.currency, toDate(e.date)); const divTWD = e.amount * (e.currency === "TWD" ? 1 : fx); totalRealizedPL += divTWD; pf[sym].realizedPLTWD += divTWD; break; } case "implicit_dividend": { const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market); const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0; if (shares > 0) { const currency = stateOnDate[sym]?.currency || 'USD'; const fx = findFxRate(market, currency, toDate(e.date)); const divTWD = e.amount_per_share * (1 - (isTwStock(sym) ? 0.0 : 0.30)) * shares * (currency === "TWD" ? 1 : fx); totalRealizedPL += divTWD; pf[sym].realizedPLTWD += divTWD; } break; } } } const { holdingsToUpdate } = calculateFinalHoldings(pf, market, evts); const xirrFlows = createCashflowsForXirr(evts, holdingsToUpdate, market); const xirr = calculateXIRR(xirrFlows); const totalUnrealizedPL = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.unrealizedPLTWD, 0); const totalInvestedCost = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.totalCostTWD, 0) + Object.values(pf).reduce((sum, p) => sum + p.realizedCostTWD, 0); const totalReturnValue = totalRealizedPL + totalUnrealizedPL; const overallReturnRate = totalInvestedCost > 0 ? (totalReturnValue / totalInvestedCost) * 100 : 0; return { holdings: { holdingsToUpdate }, totalRealizedPL, xirr, overallReturnRate }; }

// ==========================================================
// == 主計算函式 (重構以整合混合計算)
// ==========================================================
async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    console.log(`--- [${uid}] 重新計算程序開始 (v4.0.0 - 混合計算版) ---`);
    try {
        const [txs, splits, controlsData, userDividends, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT history FROM portfolio_summary WHERE uid = ?', [uid]),
        ]);

        await calculateAndCachePendingDividends(uid, txs, userDividends);

        if (txs.length === 0) {
            await d1Client.batch([
                { sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM user_dividends WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_snapshots WHERE uid = ?', params: [uid] }
            ]);
            return;
        }

        const firstTxDate = toDate(txs[0].date);
        let calculationStartDate = firstTxDate;
        let oldHistory = {};

        const latestSnapshotResult = await d1Client.query('SELECT * FROM portfolio_snapshots WHERE uid = ? ORDER BY snapshot_date DESC LIMIT 1', [uid]);
        let latestSnapshot = latestSnapshotResult[0];
        
        if (latestSnapshot && modifiedTxDate && toDate(modifiedTxDate) <= toDate(latestSnapshot.snapshot_date)) {
            console.log(`[${uid}] 偵測到歷史交易變動 (${modifiedTxDate})，將使 ${modifiedTxDate} 之後的快照失效...`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND snapshot_date >= ?', [uid, modifiedTxDate]);
            const newLatestSnapshotResult = await d1Client.query('SELECT * FROM portfolio_snapshots WHERE uid = ? ORDER BY snapshot_date DESC LIMIT 1', [uid]);
            latestSnapshot = newLatestSnapshotResult[0];
        }
        
        if (latestSnapshot) {
            const snapshotDate = toDate(latestSnapshot.snapshot_date);
            const summaryRow = summaryResult[0];
            if (summaryRow && summaryRow.history) {
                 oldHistory = JSON.parse(summaryRow.history);
                 for (const date in oldHistory) {
                    if (toDate(date) > snapshotDate) {
                        delete oldHistory[date];
                    }
                 }
            }
            const nextDay = new Date(snapshotDate);
            nextDay.setDate(nextDay.getDate() + 1);
            calculationStartDate = nextDay;
            console.log(`[${uid}] 將從快照點 ${latestSnapshot.snapshot_date} 之後開始混合計算。`);
        } else {
            console.log(`[${uid}] 找不到任何有效快照，將從頭開始完整計算。`);
        }

        const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';
        const symbolsInPortfolio = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
        const currencies = [...new Set(txs.map(t => t.currency))].filter(c => c !== "TWD");
        const fxSymbols = currencies.map(c => currencyToFx[c]).filter(Boolean);
        const allRequiredSymbols = [...new Set([...symbolsInPortfolio, ...fxSymbols, benchmarkSymbol.toUpperCase()])].filter(Boolean);
        await ensureDataFreshness(allRequiredSymbols);
        await Promise.all(allRequiredSymbols.map(symbol => ensureDataCoverage(symbol, txs[0].date.split('T')[0])));
        
        const market = await getMarketDataFromDb(txs, benchmarkSymbol);
        const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);

        if (!firstBuyDate) {
            console.log(`[${uid}] 找不到首次交易日期，計算中止。`);
            return;
        }

        const partialHistory = {};
        let curDate = new Date(calculationStartDate);
        const today = new Date();
        today.setUTCHours(0,0,0,0);
        
        if (curDate <= today) {
            console.log(`[${uid}] 執行小範圍增量計算: ${curDate.toISOString().split('T')[0]} -> 今天`);
            while(curDate <= today) {
                const dateStr = curDate.toISOString().split('T')[0];
                partialHistory[dateStr] = dailyValue(getPortfolioStateOnDate(evts, curDate, market), market, curDate, evts);
                curDate.setDate(curDate.getDate() + 1);
            }
        }
        
        const newFullHistory = { ...oldHistory, ...partialHistory };

        // 【重構】只計算一次現金流，並將結果儲存起來
        const dailyCashflows = calculateDailyCashflows(evts, market);
        
        // 【重構】將算好的現金流結果傳遞給 TWR 函式
        const { twrHistory, benchmarkHistory } = calculateTwrHistory(newFullHistory, evts, market, benchmarkSymbol, firstBuyDate, dailyCashflows);
        
        const portfolioResult = calculateCoreMetrics(evts, market);
        
        // 【重構】直接使用已算好的現金流來計算淨利，移除重複的計算邏輯
        const netProfitHistory = {};
        let cumulativeCashflow = 0;
        const sortedHistoryDates = Object.keys(newFullHistory).sort();
        for (const dateStr of sortedHistoryDates) {
            cumulativeCashflow += (dailyCashflows[dateStr] || 0);
            const marketValue = newFullHistory[dateStr] || 0;
            netProfitHistory[dateStr] = marketValue - cumulativeCashflow;
        }

        if (createSnapshot) {
            const lastDate = Object.keys(newFullHistory).pop();
            if(lastDate) {
                const marketValue = newFullHistory[lastDate];
                const finalState = getPortfolioStateOnDate(evts, new Date(lastDate), market);
                const totalCost = Object.values(finalState).reduce((sum, stock) => {
                    return sum + stock.lots.reduce((lotSum, lot) => lotSum + (lot.quantity * lot.pricePerShareTWD), 0);
                }, 0);
                await d1Client.query(
                    `INSERT OR REPLACE INTO portfolio_snapshots (uid, snapshot_date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?)`,
                    [uid, lastDate, marketValue, totalCost]
                );
                console.log(`[${uid}] 已成功建立 ${lastDate} 的每週快照。`);
            }
        }
        
        const { holdingsToUpdate } = portfolioResult.holdings;
        const dbOps = [{ sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] }];
        for (const sym in holdingsToUpdate) {
            const h = holdingsToUpdate[sym];
            dbOps.push({
                sql: `INSERT INTO holdings (uid, symbol, quantity, currency, avgCostOriginal, totalCostTWD, currentPriceOriginal, marketValueTWD, unrealizedPLTWD, realizedPLTWD, returnRate) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                params: [uid, h.symbol, h.quantity, h.currency, h.avgCostOriginal, h.totalCostTWD, h.currentPriceOriginal, h.marketValueTWD, h.unrealizedPLTWD, h.realizedPLTWD, h.returnRate]
            });
        }
        
        const summaryData = {
            totalRealizedPL: portfolioResult.totalRealizedPL,
            xirr: portfolioResult.xirr,
            overallReturnRate: portfolioResult.overallReturnRate,
            benchmarkSymbol: benchmarkSymbol
        };
        
        const summaryOps = [
            { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
            {
                sql: `INSERT INTO portfolio_summary (uid, summary_data, history, twrHistory, benchmarkHistory, netProfitHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                params: [uid, JSON.stringify(summaryData), JSON.stringify(newFullHistory), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), JSON.stringify(netProfitHistory), new Date().toISOString()]
            }
        ];
        
        await d1Client.batch(summaryOps);

        const BATCH_SIZE = 900;
        const dbOpsChunks = [];
        for (let i = 0; i < dbOps.length; i += BATCH_SIZE) {
            dbOpsChunks.push(dbOps.slice(i, i + BATCH_SIZE));
        }
        await Promise.all(dbOpsChunks.map((chunk) => d1Client.batch(chunk)));

        console.log(`--- [${uid}] 重新計算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 計算期間發生嚴重錯誤：`, e);
        throw e;
    }
}


module.exports = { performRecalculation };
