// =========================================================================================
// == GCP Cloud Function 安全性強化版 (v3.7.1 - 升級至 Functions V2 語法)
// =========================================================================================

// [修改] 從 v2 模組引入 onRequest，並引入官方建議的 logger
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

const admin = require('firebase-admin');
const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");

try {
  admin.initializeApp();
  logger.info('Firebase Admin SDK 初始化成功。');
} catch (e) {
  logger.error('Firebase Admin SDK 初始化失敗:', e);
}

// 初始化 Realtime Database 的存取權
const db = admin.database();

// --- 平台設定 ---
const D1_WORKER_URL = process.env.D1_WORKER_URL;
const D1_API_KEY = process.env.D1_API_KEY;

// --- D1 資料庫客戶端 ---
const d1Client = {
    async query(sql, params = []) {
        if (!D1_WORKER_URL || !D1_API_KEY) { throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set."); }
        try {
            const response = await axios.post(`${D1_WORKER_URL}/query`, { sql, params }, { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } });
            if (response.data && response.data.success) { return response.data.results; }
            throw new Error(response.data.error || "D1 查詢失敗");
        } catch (error) {
            logger.error("d1Client.query Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 query: ${error.message}`);
        }
    },
    async batch(statements) {
        if (!D1_WORKER_URL || !D1_API_KEY) { throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set."); }
        try {
            const response = await axios.post(`${D1_WORKER_URL}/batch`, { statements }, { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } });
            if (response.data && response.data.success) { return response.data.results; }
            throw new Error(response.data.error || "D1 批次操作失敗");
        } catch (error) {
            logger.error("d1Client.batch Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 batch: ${error.message}`);
        }
    }
};

// --- 安全性中介軟體 (Middleware) ---
const RATE_LIMIT_COUNT = 100;
const RATE_LIMIT_WINDOW = 60 * 1000;

const rateLimiter = async (req, res, next) => {
    const identifier = req.user.uid; 
    const now = Date.now();
    const ref = db.ref(`rateLimits/${identifier}`);

    try {
        const snapshot = await ref.once('value');
        const timestamps = snapshot.val() || [];
        const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);

        if (recentTimestamps.length >= RATE_LIMIT_COUNT) {
            logger.warn(`速率限制觸發: ${identifier}`);
            return res.status(429).send({ success: false, message: '請求過於頻繁，請稍後再試。' });
        }

        recentTimestamps.push(now);
        await ref.set(recentTimestamps);
        next();
    } catch (error) {
        logger.error("速率限制器錯誤:", error);
        next();
    }
};

const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(403).send({ success: false, message: 'Unauthorized: Missing or invalid authorization token.'});
        return;
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        logger.error('Token 驗證失敗:', error.message);
        res.status(403).send({ success: false, message: 'Unauthorized: Token verification failed. 請嘗試重新登入。'});
    }
};

// --- Zod Schema 定義 ---
const transactionSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    symbol: z.string().min(1).transform(val => val.toUpperCase().trim()),
    type: z.enum(['buy', 'sell']),
    quantity: z.number().positive(),
    price: z.number().positive(),
    currency: z.enum(['USD', 'TWD', 'HKD', 'JPY']),
    totalCost: z.number().positive().optional().nullable(),
    exchangeRate: z.number().positive().optional().nullable(),
});
const splitSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    symbol: z.string().min(1).transform(val => val.toUpperCase().trim()),
    ratio: z.number().positive(),
});
const userDividendSchema = z.object({
    id: z.string().uuid().optional(),
    symbol: z.string(),
    ex_dividend_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantity_at_ex_date: z.number(),
    amount_per_share: z.number(),
    total_amount: z.number(),
    tax_rate: z.number().min(0).max(100),
    currency: z.string(),
    notes: z.string().optional().nullable(),
});

// --- 所有核心函式 ---
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
const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
const getTotalCost = (tx) => (tx.totalCost != null) ? Number(tx.totalCost) : Number(tx.price || 0) * Number(tx.quantity || 0);
function findNearest(hist, date, toleranceDays = 7) { if (!hist || Object.keys(hist).length === 0) return undefined; const tgt = toDate(date); if(!tgt) return undefined; const tgtStr = tgt.toISOString().slice(0, 10); if (hist[tgtStr]) return hist[tgtStr]; for (let i = 1; i <= toleranceDays; i++) { const checkDate = new Date(tgt); checkDate.setDate(checkDate.getDate() - i); const checkDateStr = checkDate.toISOString().split('T')[0]; if (hist[checkDateStr]) return hist[checkDateStr]; } const sortedDates = Object.keys(hist).sort((a, b) => new Date(b) - new Date(a)); for (const dateStr of sortedDates) { if (dateStr <= tgtStr) return hist[dateStr]; } return undefined; }
function findFxRate(market, currency, date, tolerance = 15) { if (!currency || currency === "TWD") return 1; const fxSym = currencyToFx[currency]; if (!fxSym || !market[fxSym]) return 1; return findNearest(market[fxSym]?.rates || {}, date, tolerance) ?? 1; }
function getPortfolioStateOnDate(allEvts, targetDate, market) { const state = {}; const pastEvents = allEvts.filter(e => toDate(e.date) <= toDate(targetDate)); for (const e of pastEvents) { const sym = e.symbol.toUpperCase(); if (!state[sym]) state[sym] = { lots: [], currency: e.currency || "USD" }; if (e.eventType === 'transaction') { state[sym].currency = e.currency; if (e.type === 'buy') { const fx = findFxRate(market, e.currency, toDate(e.date)); const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx); state[sym].lots.push({ quantity: e.quantity, pricePerShareTWD: costTWD / (e.quantity || 1), pricePerShareOriginal: e.price, date: toDate(e.date) }); } else { let sellQty = e.quantity; while (sellQty > 0 && state[sym].lots.length > 0) { const lot = state[sym].lots[0]; if (lot.quantity <= sellQty) { sellQty -= lot.quantity; state[sym].lots.shift(); } else { lot.quantity -= sellQty; sellQty = 0; } } } } else if (e.eventType === 'split') { state[sym].lots.forEach(lot => { lot.quantity *= e.ratio; lot.pricePerShareTWD /= e.ratio; lot.pricePerShareOriginal /= e.ratio; }); } } return state; }
function dailyValue(state, market, date, allEvts) { return Object.keys(state).reduce((totalValue, sym) => { const s = state[sym]; const qty = s.lots.reduce((sum, lot) => sum + lot.quantity, 0); if (qty < 1e-9) return totalValue; let price = findNearest(market[sym]?.prices, date); if (price === undefined) { const yesterday = new Date(date); yesterday.setDate(yesterday.getDate() - 1); const firstLotDate = s.lots.length > 0 ? toDate(s.lots[0].date) : date; if (yesterday < firstLotDate) return totalValue; return totalValue + dailyValue({ [sym]: s }, market, yesterday, allEvts); } const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym.toUpperCase() && toDate(e.date) > toDate(date)); const adjustmentRatio = futureSplits.reduce((acc, split) => acc * split.ratio, 1); const unadjustedPrice = price * adjustmentRatio; const fx = findFxRate(market, s.currency, date); return totalValue + (qty * unadjustedPrice * (s.currency === "TWD" ? 1 : fx)); }, 0); }
function prepareEvents(txs, splits, market, userDividends) { const firstBuyDateMap = {}; txs.forEach(tx => { if (tx.type === "buy") { const sym = tx.symbol.toUpperCase(); const d = toDate(tx.date); if (!firstBuyDateMap[sym] || d < firstBuyDateMap[sym]) firstBuyDateMap[sym] = d; }}); const evts = [ ...txs.map(t => ({ ...t, eventType: "transaction" })), ...splits.map(s => ({ ...s, eventType: "split" })) ]; const confirmedDividendKeys = new Set(userDividends.map(d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`)); userDividends.forEach(ud => evts.push({ eventType: 'confirmed_dividend', date: toDate(ud.pay_date), symbol: ud.symbol.toUpperCase(), amount: ud.total_amount, currency: ud.currency })); Object.keys(market).forEach(sym => { if (market[sym]?.dividends) { Object.entries(market[sym].dividends).forEach(([dateStr, amount]) => { const dividendDate = toDate(dateStr); if (confirmedDividendKeys.has(`${sym.toUpperCase()}_${dateStr}`)) return; if (firstBuyDateMap[sym] && dividendDate >= firstBuyDateMap[sym] && amount > 0) { const payDate = new Date(dividendDate); payDate.setMonth(payDate.getMonth() + 1); evts.push({ eventType: "implicit_dividend", date: payDate, ex_date: dividendDate, symbol: sym.toUpperCase(), amount_per_share: amount }); } }); } }); evts.sort((a, b) => toDate(a.date) - toDate(b.date)); const firstTx = evts.find(e => e.eventType === 'transaction'); return { evts, firstBuyDate: firstTx ? toDate(firstTx.date) : null }; }
function calculateDailyPortfolioValues(evts, market, startDate) { if (!startDate) return {}; let curDate = new Date(startDate); curDate.setUTCHours(0, 0, 0, 0); const today = new Date(); today.setUTCHours(0, 0, 0, 0); const history = {}; while (curDate <= today) { const dateStr = curDate.toISOString().split("T")[0]; history[dateStr] = dailyValue(getPortfolioStateOnDate(evts, curDate, market), market, curDate, evts); curDate.setDate(curDate.getDate() + 1); } return history; }
function calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, startDate, log = logger.info) { const dates = Object.keys(dailyPortfolioValues).sort(); if (!startDate || dates.length === 0) return { twrHistory: {}, benchmarkHistory: {} }; const upperBenchmarkSymbol = benchmarkSymbol.toUpperCase(); const benchmarkPrices = market[upperBenchmarkSymbol]?.prices || {}; const benchmarkCurrency = isTwStock(upperBenchmarkSymbol) ? "TWD" : "USD"; const startFxRate = findFxRate(market, benchmarkCurrency, startDate); const benchmarkStartPriceOriginal = findNearest(benchmarkPrices, startDate); if (!benchmarkStartPriceOriginal) { log(`TWR_CALC_FAIL: Cannot find start price for benchmark ${upperBenchmarkSymbol}.`); return { twrHistory: {}, benchmarkHistory: {} }; } const benchmarkStartPriceTWD = benchmarkStartPriceOriginal * startFxRate; const cashflows = evts.reduce((acc, e) => { const dateStr = toDate(e.date).toISOString().split('T')[0]; let flow = 0; if (e.eventType === 'transaction') { const currency = e.currency || 'USD'; const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, toDate(e.date)); flow = (e.type === 'buy' ? 1 : -1) * getTotalCost(e) * (currency === 'TWD' ? 1 : fx); } else if (e.eventType === 'confirmed_dividend') { const fx = findFxRate(market, e.currency, toDate(e.date)); flow = -1 * e.amount * (e.currency === 'TWD' ? 1 : fx); } else if (e.eventType === 'implicit_dividend') { const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market); const shares = stateOnDate[e.symbol.toUpperCase()]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0; if (shares > 0) { const currency = stateOnDate[e.symbol.toUpperCase()]?.currency || 'USD'; const fx = findFxRate(market, currency, toDate(e.date)); const postTaxAmount = e.amount_per_share * (1 - (isTwStock(e.symbol) ? 0.0 : 0.30)); flow = -1 * postTaxAmount * shares * fx; } } if (flow !== 0) acc[dateStr] = (acc[dateStr] || 0) + flow; return acc; }, {}); const twrHistory = {}, benchmarkHistory = {}; let cumulativeHpr = 1, lastMarketValue = 0; for (const dateStr of dates) { const MVE = dailyPortfolioValues[dateStr]; const CF = cashflows[dateStr] || 0; const denominator = lastMarketValue + CF; if (denominator !== 0) cumulativeHpr *= MVE / denominator; twrHistory[dateStr] = (cumulativeHpr - 1) * 100; lastMarketValue = MVE; const currentBenchPriceOriginal = findNearest(benchmarkPrices, new Date(dateStr)); if (currentBenchPriceOriginal && benchmarkStartPriceTWD > 0) { const currentFxRate = findFxRate(market, benchmarkCurrency, new Date(dateStr)); benchmarkHistory[dateStr] = ((currentBenchPriceOriginal * currentFxRate / benchmarkStartPriceTWD) - 1) * 100; } } return { twrHistory, benchmarkHistory }; }
function calculateFinalHoldings(pf, market, allEvts) { const holdingsToUpdate = {}; const today = new Date(); for (const sym in pf) { const h = pf[sym]; const qty = h.lots.reduce((s, l) => s + l.quantity, 0); if (qty > 1e-9) { const totCostTWD = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareTWD, 0); const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0); const curPrice = findNearest(market[sym]?.prices || {}, today); const fx = findFxRate(market, h.currency, today); const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym.toUpperCase() && toDate(e.date) > today); const unadjustedPrice = (curPrice ?? 0) * futureSplits.reduce((acc, split) => acc * split.ratio, 1); const mktVal = qty * unadjustedPrice * (h.currency === "TWD" ? 1 : fx); holdingsToUpdate[sym] = { symbol: sym, quantity: qty, currency: h.currency, avgCostOriginal: totCostOrg > 0 ? totCostOrg / qty : 0, totalCostTWD: totCostTWD, currentPriceOriginal: unadjustedPrice, marketValueTWD: mktVal, unrealizedPLTWD: mktVal - totCostTWD, realizedPLTWD: h.realizedPLTWD, returnRate: totCostTWD > 0 ? ((mktVal - totCostTWD) / totCostTWD) * 100 : 0 }; } } return { holdingsToUpdate }; }
function createCashflowsForXirr(evts, holdings, market) { const flows = []; evts.forEach(e => { let amt = 0, flowDate = toDate(e.date); if (e.eventType === "transaction") { const currency = e.currency || 'USD'; const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, flowDate); amt = (e.type === "buy" ? -getTotalCost(e) : getTotalCost(e)) * (currency === 'TWD' ? 1 : fx); } else if (e.eventType === "confirmed_dividend") { const fx = findFxRate(market, e.currency, flowDate); amt = e.amount * (e.currency === 'TWD' ? 1 : fx); } else if (e.eventType === "implicit_dividend") { const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market); const sym = e.symbol.toUpperCase(); const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0; if (shares > 0) { const currency = stateOnDate[sym]?.currency || 'USD'; const fx = findFxRate(market, currency, flowDate); const postTaxAmount = e.amount_per_share * (1 - (isTwStock(sym) ? 0.0 : 0.30)); amt = postTaxAmount * shares * (currency === "TWD" ? 1 : fx); } } if (Math.abs(amt) > 1e-6) flows.push({ date: flowDate, amount: amt }); }); const totalMarketValue = Object.values(holdings).reduce((s, h) => s + h.marketValueTWD, 0); if (totalMarketValue > 0) flows.push({ date: new Date(), amount: totalMarketValue }); const combined = flows.reduce((acc, flow) => { const dateStr = flow.date.toISOString().slice(0, 10); acc[dateStr] = (acc[dateStr] || 0) + flow.amount; return acc; }, {}); return Object.entries(combined).filter(([, amount]) => Math.abs(amount) > 1e-6).map(([date, amount]) => ({ date: new Date(date), amount })).sort((a, b) => a.date - b.date); }
function calculateXIRR(flows) { if (flows.length < 2) return null; const amounts = flows.map(f => f.amount); if (!amounts.some(v => v < 0) || !amounts.some(v => v > 0)) return null; const dates = flows.map(f => f.date); const epoch = dates[0].getTime(); const years = dates.map(d => (d.getTime() - epoch) / (365.25 * 24 * 60 * 60 * 1000)); let guess = 0.1, npv; for (let i = 0; i < 50; i++) { if (1 + guess <= 0) { guess /= -2; continue; } npv = amounts.reduce((sum, amount, j) => sum + amount / Math.pow(1 + guess, years[j]), 0); if (Math.abs(npv) < 1e-6) return guess; const derivative = amounts.reduce((sum, amount, j) => sum - years[j] * amount / Math.pow(1 + guess, years[j] + 1), 0); if (Math.abs(derivative) < 1e-9) break; guess -= npv / derivative; } return (npv && Math.abs(npv) < 1e-6) ? guess : null; }
function calculateCoreMetrics(evts, market) { const pf = {}; let totalRealizedPL = 0; for (const e of evts) { const sym = e.symbol.toUpperCase(); if (!pf[sym]) pf[sym] = { lots: [], currency: e.currency || "USD", realizedPLTWD: 0, realizedCostTWD: 0 }; switch (e.eventType) { case "transaction": { const fx = (e.exchangeRate && e.currency !== 'TWD') ? e.exchangeRate : findFxRate(market, e.currency, toDate(e.date)); const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx); if (e.type === "buy") { pf[sym].lots.push({ quantity: e.quantity, pricePerShareOriginal: e.price, pricePerShareTWD: costTWD / (e.quantity || 1), date: toDate(e.date) }); } else { let sellQty = e.quantity; let costOfGoodsSoldTWD = 0; while (sellQty > 0 && pf[sym].lots.length > 0) { const lot = pf[sym].lots[0]; const qtyToSell = Math.min(sellQty, lot.quantity); costOfGoodsSoldTWD += qtyToSell * lot.pricePerShareTWD; lot.quantity -= qtyToSell; sellQty -= qtyToSell; if (lot.quantity < 1e-9) pf[sym].lots.shift(); } const realized = costTWD - costOfGoodsSoldTWD; totalRealizedPL += realized; pf[sym].realizedCostTWD += costOfGoodsSoldTWD; pf[sym].realizedPLTWD += realized; } break; } case "split": { pf[sym].lots.forEach(l => { l.quantity *= e.ratio; l.pricePerShareTWD /= e.ratio; l.pricePerShareOriginal /= e.ratio; }); break; } case "confirmed_dividend": { const fx = findFxRate(market, e.currency, toDate(e.date)); const divTWD = e.amount * (e.currency === "TWD" ? 1 : fx); totalRealizedPL += divTWD; pf[sym].realizedPLTWD += divTWD; break; } case "implicit_dividend": { const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market); const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0; if (shares > 0) { const currency = stateOnDate[sym]?.currency || 'USD'; const fx = findFxRate(market, currency, toDate(e.date)); const divTWD = e.amount_per_share * (1 - (isTwStock(sym) ? 0.0 : 0.30)) * shares * (currency === "TWD" ? 1 : fx); totalRealizedPL += divTWD; pf[sym].realizedPLTWD += divTWD; } break; } } } const { holdingsToUpdate } = calculateFinalHoldings(pf, market, evts); const xirrFlows = createCashflowsForXirr(evts, holdingsToUpdate, market); const xirr = calculateXIRR(xirrFlows); const totalUnrealizedPL = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.unrealizedPLTWD, 0); const totalInvestedCost = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.totalCostTWD, 0) + Object.values(pf).reduce((sum, p) => sum + p.realizedCostTWD, 0); const totalReturnValue = totalRealizedPL + totalUnrealizedPL; const overallReturnRate = totalInvestedCost > 0 ? (totalReturnValue / totalInvestedCost) * 100 : 0; return { holdings: { holdingsToUpdate }, totalRealizedPL, xirr, overallReturnRate }; }
async function performRecalculation(uid) {
    logger.info(`--- [${uid}] 重新計算程序開始 (v3.7.1) ---`);
    try {
        const [txs, splits, controlsData, userDividends] = await Promise.all([ d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]), d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]), d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']), d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]), ]);
        if (txs.length === 0) { await d1Client.batch([{ sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] }, { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] }, { sql: 'DELETE FROM user_dividends WHERE uid = ?', params: [uid] }]); return; }
        const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';
        const symbolsInPortfolio = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
        const currencies = [...new Set(txs.map(t => t.currency))].filter(c => c !== "TWD");
        const fxSymbols = currencies.map(c => currencyToFx[c]).filter(Boolean);
        const allRequiredSymbols = [...new Set([...symbolsInPortfolio, ...fxSymbols, benchmarkSymbol.toUpperCase()])].filter(Boolean);
        await ensureDataFreshness(allRequiredSymbols);
        const firstDate = txs[0].date.split('T')[0];
        await Promise.all(allRequiredSymbols.map(symbol => ensureDataCoverage(symbol, firstDate)));
        const market = await getMarketDataFromDb(txs, benchmarkSymbol);
        const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);
        if (!firstBuyDate) { logger.warn(`[${uid}] 找不到首次交易日期，計算中止。`); return; }
        const portfolioResult = calculateCoreMetrics(evts, market);
        const dailyPortfolioValues = calculateDailyPortfolioValues(evts, market, firstBuyDate);
        const { twrHistory, benchmarkHistory } = calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, firstBuyDate);
        const { holdingsToUpdate } = portfolioResult.holdings;
        const dbOps = [{ sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] }];
        for (const sym in holdingsToUpdate) { const h = holdingsToUpdate[sym]; dbOps.push({ sql: `INSERT INTO holdings (uid, symbol, quantity, currency, avgCostOriginal, totalCostTWD, currentPriceOriginal, marketValueTWD, unrealizedPLTWD, realizedPLTWD, returnRate) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, params: [uid, h.symbol, h.quantity, h.currency, h.avgCostOriginal, h.totalCostTWD, h.currentPriceOriginal, h.marketValueTWD, h.unrealizedPLTWD, h.realizedPLTWD, h.returnRate]}); }
        const summaryData = { totalRealizedPL: portfolioResult.totalRealizedPL, xirr: portfolioResult.xirr, overallReturnRate: portfolioResult.overallReturnRate, benchmarkSymbol: benchmarkSymbol };
        const summaryOps = [ { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] }, { sql: `INSERT INTO portfolio_summary (uid, summary_data, history, twrHistory, benchmarkHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?)`, params: [uid, JSON.stringify(summaryData), JSON.stringify(dailyPortfolioValues), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), new Date().toISOString()]} ];
        await d1Client.batch(summaryOps);
        const BATCH_SIZE = 900; const dbOpsChunks = [];
        for (let i = 0; i < dbOps.length; i += BATCH_SIZE) { dbOpsChunks.push(dbOps.slice(i, i + BATCH_SIZE)); }
        await Promise.all(dbOpsChunks.map((chunk) => d1Client.batch(chunk)));
        logger.info(`--- [${uid}] 重新計算程序完成 ---`);
    } catch (e) { 
        logger.error(`[${uid}] 計算期間發生嚴重錯誤：`, e); 
        throw e; 
    }
}

// [修改] 使用 v2 語法來導出 HTTP 函式
// 增加了 timeoutSeconds 和 memory 選項，以應對可能較長的計算時間
exports.unifiedPortfolioHandler = onRequest(
    {
        region: 'asia-east1',
        timeoutSeconds: 300, // 將超時時間設為 5 分鐘
        memory: '512MiB'     // 分配 512MB 記憶體
    },
    async (req, res) => {
    const allowedOrigins = [
        'https://portfolio-journal.pages.dev',
        'https://portfolio-journal-467915.firebaseapp.com'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
    }

    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Service-Account-Key, X-API-KEY');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
    const serviceAccountKey = req.headers['x-service-account-key'];
    if (serviceAccountKey) {
        if (serviceAccountKey !== process.env.SERVICE_ACCOUNT_KEY) {
            return res.status(403).send({ success: false, message: 'Invalid Service Account Key' });
        }
        if (req.headers['x-api-key'] !== D1_API_KEY) {
            return res.status(401).send({ success: false, message: 'Invalid D1 API Key for Service Account' });
        }
        if (req.body.action === 'recalculate_all_users') {
            try {
                const allUidsResult = await d1Client.query('SELECT DISTINCT uid FROM transactions');
                for (const row of allUidsResult) { await performRecalculation(row.uid); }
                return res.status(200).send({ success: true, message: '所有使用者重算成功。' });
            } catch (error) { return res.status(500).send({ success: false, message: `重算過程中發生錯誤: ${error.message}` }); }
        }
        return res.status(400).send({ success: false, message: '無效的服務操作。' });
    }

    await verifyFirebaseToken(req, res, async () => {
        await rateLimiter(req, res, async () => {
            try {
                const uid = req.user.uid; 
                const { action, data } = req.body;
                if (!action) return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });
                switch (action) {
                    case 'get_data': {
                        const [txs, splits, holdings, summaryResult, stockNotes] = await Promise.all([
                            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
                            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
                            d1Client.query('SELECT * FROM holdings WHERE uid = ?', [uid]),
                            d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ?', [uid]),
                            d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
                        ]);
                        const summaryRow = summaryResult[0] || {};
                        return res.status(200).send({ success: true, data: {
                            summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
                            holdings, transactions: txs, splits, stockNotes,
                            history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
                            twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
                            benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
                        }});
                    }
                    case 'add_transaction': case 'edit_transaction': {
                        const isEditing = action === 'edit_transaction';
                        const txData = transactionSchema.parse(isEditing ? data.txData : data);
                        const txId = isEditing ? data.txId : uuidv4();
                        if (isEditing) await d1Client.query(`UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`, [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]);
                        else await d1Client.query(`INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]);
                        await performRecalculation(uid);
                        return res.status(200).send({ success: true, message: '操作成功。', id: txId });
                    }
                    case 'delete_transaction': {
                        await d1Client.query('DELETE FROM transactions WHERE id = ? AND uid = ?', [data.txId, uid]);
                        await performRecalculation(uid); return res.status(200).send({ success: true, message: '交易已刪除。' });
                    }
                    case 'update_benchmark': {
                        await d1Client.query('INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)', [uid, 'benchmarkSymbol', data.benchmarkSymbol.toUpperCase()]);
                        await performRecalculation(uid); return res.status(200).send({ success: true, message: '基準已更新。' });
                    }
                    case 'add_split': {
                        const splitData = splitSchema.parse(data); const newSplitId = uuidv4();
                        await d1Client.query(`INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`, [newSplitId, uid, splitData.date, splitData.symbol, splitData.ratio]);
                        await performRecalculation(uid); return res.status(200).send({ success: true, message: '分割事件已新增。', splitId: newSplitId });
                    }
                    case 'delete_split': {
                        await d1Client.query('DELETE FROM splits WHERE id = ? AND uid = ?', [data.splitId, uid]);
                        await performRecalculation(uid); return res.status(200).send({ success: true, message: '分割事件已刪除。' });
                    }
                    case 'get_dividends_for_management': {
                        const [txs, allDividendsHistory, userDividends] = await Promise.all([
                            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
                            d1Client.query('SELECT * FROM dividend_history ORDER BY date ASC'),
                            d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid])
                        ]);
                        if (txs.length === 0) return res.status(200).send({ success: true, data: { pendingDividends: [], confirmedDividends: userDividends } });
                        const holdings = {}; let txIndex = 0; const confirmedKeys = new Set(userDividends.map(d => `${d.symbol}_${d.ex_dividend_date.split('T')[0]}`));
                        const pendingDividends = []; const uniqueSymbolsInTxs = [...new Set(txs.map(t => t.symbol))];
                        allDividendsHistory.forEach(histDiv => {
                            const divSymbol = histDiv.symbol; if (!uniqueSymbolsInTxs.includes(divSymbol)) return;
                            const exDateStr = histDiv.date.split('T')[0]; if (confirmedKeys.has(`${divSymbol}_${exDateStr}`)) return;
                            const exDateMinusOne = new Date(exDateStr); exDateMinusOne.setDate(exDateMinusOne.getDate() - 1);
                            while(txIndex < txs.length && new Date(txs[txIndex].date) <= exDateMinusOne) {
                                const tx = txs[txIndex]; holdings[tx.symbol] = (holdings[tx.symbol] || 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity); txIndex++;
                            }
                            const quantity = holdings[divSymbol] || 0;
                            if (quantity > 0) {
                                 const currency = txs.find(t => t.symbol === divSymbol)?.currency || (isTwStock(divSymbol) ? 'TWD' : 'USD');
                                 pendingDividends.push({ symbol: divSymbol, ex_dividend_date: exDateStr, amount_per_share: histDiv.dividend, quantity_at_ex_date: quantity, currency: currency });
                            }
                        });
                        return res.status(200).send({ success: true, data: { pendingDividends: pendingDividends.sort((a,b) => new Date(b.ex_dividend_date) - new Date(a.ex_dividend_date)), confirmedDividends: userDividends }});
                    }
                    case 'save_user_dividend': {
                        const parsedData = userDividendSchema.parse(data); const { id, ...divData } = parsedData; const dividendId = id || uuidv4();
                        if (id) await d1Client.query(`UPDATE user_dividends SET pay_date = ?, total_amount = ?, tax_rate = ?, notes = ? WHERE id = ? AND uid = ?`,[divData.pay_date, divData.total_amount, divData.tax_rate, divData.notes, id, uid]);
                        else await d1Client.query(`INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`, [dividendId, uid, divData.symbol, divData.ex_dividend_date, divData.pay_date, divData.amount_per_share, divData.quantity_at_ex_date, divData.total_amount, divData.tax_rate, divData.currency, divData.notes]);
                        await performRecalculation(uid); return res.status(200).send({ success: true, message: '配息紀錄已儲存。' });
                    }
                    case 'bulk_confirm_all_dividends': {
                        const pendingDividends = data.pendingDividends || [];
                        if (pendingDividends.length === 0) return res.status(200).send({ success: true, message: '沒有需要批次確認的配息。' });
                        const dbOps = [];
                        for (const pending of pendingDividends) {
                            const payDate = new Date(pending.ex_dividend_date); payDate.setMonth(payDate.getMonth() + 1); const payDateStr = payDate.toISOString().split('T')[0];
                            const taxRate = isTwStock(pending.symbol) ? 0.0 : 0.30; const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate);
                            dbOps.push({ sql: `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '批次確認')`, params: [uuidv4(), uid, pending.symbol, pending.ex_dividend_date, payDateStr, pending.amount_per_share, pending.quantity_at_ex_date, totalAmount, taxRate * 100, pending.currency]});
                        }
                        if (dbOps.length > 0) { await d1Client.batch(dbOps); await performRecalculation(uid); }
                        return res.status(200).send({ success: true, message: `成功批次確認 ${dbOps.length} 筆配息紀錄。` });
                    }
                    case 'delete_user_dividend': {
                        await d1Client.query('DELETE FROM user_dividends WHERE id = ? AND uid = ?', [data.dividendId, uid]);
                        await performRecalculation(uid); return res.status(200).send({ success: true, message: '配息紀錄已刪除。' });
                    }
                    case 'save_stock_note': {
                        const { symbol, target_price, stop_loss_price, notes } = data;
                        const existing = await d1Client.query('SELECT id FROM user_stock_notes WHERE uid = ? AND symbol = ?', [uid, symbol]);
                        if (existing.length > 0) await d1Client.query('UPDATE user_stock_notes SET target_price = ?, stop_loss_price = ?, notes = ?, last_updated = ? WHERE id = ?', [target_price, stop_loss_price, notes, new Date().toISOString(), existing[0].id]);
                        else await d1Client.query('INSERT INTO user_stock_notes (id, uid, symbol, target_price, stop_loss_price, notes, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)', [uuidv4(), uid, symbol, target_price, stop_loss_price, notes, new Date().toISOString()]);
                        return res.status(200).send({ success: true, message: '筆記已儲存。' });
                    }
                    default:
                        return res.status(400).send({ success: false, message: '未知的操作' });
                }
            } catch (error) {
                logger.error(`[${req.user?.uid || 'N/A'}] 執行 action: '${req.body?.action}' 時發生錯誤:`, error);
                if (error instanceof z.ZodError) return res.status(400).send({ success: false, message: "輸入資料格式驗證失敗", errors: error.errors });
                res.status(500).send({ success: false, message: `伺服器內部錯誤：${error.message}` });
            }
        });
    });
});
