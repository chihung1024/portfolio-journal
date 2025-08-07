// =========================================================================================
// == GCP Cloud Function 安全性強化版 (v2.8.1 - 配息管理功能修正版)
// =========================================================================================

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');

try {
  admin.initializeApp();
  console.log('Firebase Admin SDK 初始化成功。');
} catch (e) {
  console.error('Firebase Admin SDK 初始化失敗，請檢查環境設定。', e);
}

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
            console.error("d1Client.query Error:", error.response ? error.response.data : error.message);
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
            console.error("d1Client.batch Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 batch: ${error.message}`);
        }
    }
};

// --- 安全性中介軟體 (Middleware) ---
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
        console.error('Token 驗證失敗:', error.message);
        res.status(403).send({ success: false, message: 'Unauthorized: Token verification failed. 請嘗試重新登入。'});
    }
};

// --- Zod Schema 定義 ---
const { z } = require("zod");

const transactionSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須為 YYYY-MM-DD"),
    symbol: z.string().min(1, "股票代碼為必填").transform(val => val.toUpperCase().trim()),
    type: z.enum(['buy', 'sell']),
    quantity: z.number().positive("股數必須為正數"),
    price: z.number().positive("價格必須為正數"),
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


// --- 資料抓取與覆蓋範圍管理 ---
async function fetchAndSaveMarketDataRange(symbol, startDate, endDate) {
    try {
        console.log(`[Data Fetch] 正在從 Yahoo Finance 抓取 ${symbol} 從 ${startDate} 到 ${endDate} 的數據...`);
        const hist = await yahooFinance.historical(symbol, {
            period1: startDate,
            period2: endDate,
            interval: '1d',
            autoAdjust: false,
            backAdjust: false
        });

        if (!hist || hist.length === 0) {
            console.warn(`[Data Fetch] 警告：在指定區間內找不到 ${symbol} 的數據。`);
            return [];
        }

        const dbOps = [];
        const tableName = symbol.includes("=") ? "exchange_rates" : "price_history";

        for (const item of hist) {
            const itemDate = item.date.toISOString().split('T')[0];
            if (item.close) {
                dbOps.push({
                    sql: `INSERT OR IGNORE INTO ${tableName} (symbol, date, price) VALUES (?, ?, ?)`,
                    params: [symbol, itemDate, item.close]
                });
            }
            if (!symbol.includes("=") && item.dividends && item.dividends > 0) {
                dbOps.push({
                    sql: `INSERT OR IGNORE INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)`,
                    params: [symbol, itemDate, item.dividends]
                });
            }
        }

        if (dbOps.length > 0) {
            await d1Client.batch(dbOps);
            console.log(`[Data Fetch] 成功寫入 ${dbOps.length} 筆 ${symbol} 的新數據到 D1。`);
        }
        return hist;

    } catch (e) {
        console.error(`[Data Fetch] 錯誤：抓取 ${symbol} 的市場資料失敗。原因：${e.message}`);
        return null;
    }
}

async function ensureDataCoverage(symbol, requiredStartDate) {
    if (!symbol || !requiredStartDate) return;
    console.log(`[Coverage Check] 檢查 ${symbol} 的數據覆蓋範圍，要求至少從 ${requiredStartDate} 開始。`);

    const coverageData = await d1Client.query('SELECT earliest_date FROM market_data_coverage WHERE symbol = ?', [symbol]);
    const today = new Date().toISOString().split('T')[0];

    if (coverageData.length === 0) {
        console.log(`[Coverage Check] ${symbol} 是新商品，將抓取從 ${requiredStartDate} 到今天的完整數據。`);
        const fetchedData = await fetchAndSaveMarketDataRange(symbol, requiredStartDate, today);

        if (fetchedData && fetchedData.length > 0) {
            const actualEarliestDate = fetchedData[0].date.toISOString().split('T')[0];
            console.log(`[Coverage Check] API 返回的實際最早日期為 ${actualEarliestDate}，將以此日期為準進行記錄。`);
            await d1Client.query(
                'INSERT INTO market_data_coverage (symbol, earliest_date, last_updated) VALUES (?, ?, ?)',
                [symbol, actualEarliestDate, today]
            );
        } else {
            console.warn(`[Coverage Check] ${symbol} 首次抓取未能返回任何數據，將不會在 coverage 表中創建紀錄。`);
        }
        return;
    }

    const currentEarliestDate = coverageData[0].earliest_date;
    if (requiredStartDate < currentEarliestDate) {
        console.log(`[Coverage Check] 新日期 ${requiredStartDate} 早於現有紀錄 ${currentEarliestDate}。將對 ${symbol} 執行完整數據覆蓋。`);
        
        const isFx = symbol.includes("=");
        const priceTable = isFx ? "exchange_rates" : "price_history";
        const deleteOps = [{ sql: `DELETE FROM ${priceTable} WHERE symbol = ?`, params: [symbol] }];
        if (!isFx) {
            deleteOps.push({ sql: `DELETE FROM dividend_history WHERE symbol = ?`, params: [symbol] });
        }
        await d1Client.batch(deleteOps);
        console.log(`[Coverage Check] 已刪除 ${symbol} 的所有舊市場數據。`);

        const fetchedData = await fetchAndSaveMarketDataRange(symbol, requiredStartDate, today);

        if (fetchedData && fetchedData.length > 0) {
            const actualEarliestDate = fetchedData[0].date.toISOString().split('T')[0];
             console.log(`[Coverage Check] API 重新抓取後，返回的實際最早日期為 ${actualEarliestDate}。`);
            await d1Client.query(
                'UPDATE market_data_coverage SET earliest_date = ?, last_updated = ? WHERE symbol = ?',
                [actualEarliestDate, today, symbol]
            );
        } else {
             console.warn(`[Coverage Check] ${symbol} 重新抓取未能返回任何數據，earliest_date 維持不變。`);
        }

    } else {
        console.log(`[Coverage Check] ${symbol} 的數據已覆蓋所需日期，無需更新。`);
    }
}

async function getMarketDataFromDb(txs, benchmarkSymbol) {
    const symbolsInPortfolio = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
    const currencies = [...new Set(txs.map(t => t.currency))].filter(c => c !== "TWD");
    const requiredFxSymbols = currencies.map(c => currencyToFx[c]).filter(Boolean);
    const requiredStockSymbols = [...new Set([...symbolsInPortfolio, benchmarkSymbol.toUpperCase()])].filter(Boolean);

    console.log(`[DB Read] 開始批次讀取市場數據...`);
    console.log(`[DB Read] 股票標的: ${requiredStockSymbols.join(', ') || '無'}`);
    console.log(`[DB Read] 匯率標的: ${requiredFxSymbols.join(', ') || '無'}`);

    const promises = [];
    
    if (requiredStockSymbols.length > 0) {
        const placeholders = requiredStockSymbols.map(() => '?').join(',');
        const priceSql = `SELECT symbol, date, price FROM price_history WHERE symbol IN (${placeholders})`;
        const dividendSql = `SELECT symbol, date, dividend FROM dividend_history WHERE symbol IN (${placeholders})`;
        promises.push(d1Client.query(priceSql, requiredStockSymbols));
        promises.push(d1Client.query(dividendSql, requiredStockSymbols));
    } else {
        promises.push(Promise.resolve([]));
        promises.push(Promise.resolve([]));
    }

    if (requiredFxSymbols.length > 0) {
        const placeholders = requiredFxSymbols.map(() => '?').join(',');
        const fxSql = `SELECT symbol, date, price FROM exchange_rates WHERE symbol IN (${placeholders})`;
        promises.push(d1Client.query(fxSql, requiredFxSymbols));
    } else {
        promises.push(Promise.resolve([]));
    }

    const [stockPricesFlat, stockDividendsFlat, fxRatesFlat] = await Promise.all(promises);

    const allSymbols = [...requiredStockSymbols, ...requiredFxSymbols];

    const marketData = allSymbols.reduce((acc, symbol) => {
        acc[symbol] = { prices: {}, dividends: {} };
        return acc;
    }, {});

    stockPricesFlat.forEach(row => {
        const date = row.date.split('T')[0];
        marketData[row.symbol].prices[date] = row.price;
    });

    stockDividendsFlat.forEach(row => {
        const date = row.date.split('T')[0];
        marketData[row.symbol].dividends[date] = row.dividend;
    });

    fxRatesFlat.forEach(row => {
        const date = row.date.split('T')[0];
        marketData[row.symbol].prices[date] = row.price;
    });
    requiredFxSymbols.forEach(fxSymbol => {
        if(marketData[fxSymbol]) {
            marketData[fxSymbol].rates = marketData[fxSymbol].prices;
        }
    });

    console.log("[DB Read] 所有市場數據已透過批次查詢載入記憶體。");
    return marketData;
}


// --- 核心計算與輔助函式 ---
const toDate = v => {
    if (!v) return null;
    const d = v.toDate ? v.toDate() : new Date(v);
    if (d instanceof Date && !isNaN(d)) {
      d.setUTCHours(0, 0, 0, 0);
    }
    return d;
};
const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
const isTwStock = (symbol) => {
    if (!symbol) return false;
    const upperSymbol = symbol.toUpperCase();
    return upperSymbol.endsWith('.TW') || upperSymbol.endsWith('.TWO');
};
const getTotalCost = (tx) => (tx.totalCost != null) ? Number(tx.totalCost) : Number(tx.price || 0) * Number(tx.quantity || 0);

function findNearest(hist, date, toleranceDays = 7) {
    if (!hist || Object.keys(hist).length === 0) return undefined;
    const tgt = toDate(date);
    if(!tgt) return undefined;
    const tgtStr = tgt.toISOString().slice(0, 10);
    if (hist[tgtStr]) return hist[tgtStr];
    for (let i = 1; i <= toleranceDays; i++) {
        const checkDate = new Date(tgt);
        checkDate.setDate(checkDate.getDate() - i);
        const checkDateStr = checkDate.toISOString().split('T')[0];
        if (hist[checkDateStr]) return hist[checkDateStr];
    }
    const sortedDates = Object.keys(hist).sort((a, b) => new Date(b) - new Date(a));
    for (const dateStr of sortedDates) {
        if (dateStr <= tgtStr) return hist[dateStr];
    }
    return undefined;
}

function findFxRate(market, currency, date, tolerance = 15) {
    if (!currency || currency === "TWD") return 1;
    const fxSym = currencyToFx[currency];
    if (!fxSym || !market[fxSym]) return 1;
    const hist = market[fxSym]?.rates || {};
    return findNearest(hist, date, tolerance) ?? 1;
}

function getPortfolioStateOnDate(allEvts, targetDate, market) {
    const state = {};
    const pastEvents = allEvts.filter(e => toDate(e.date) <= toDate(targetDate));

    for (const e of pastEvents) {
        const sym = e.symbol.toUpperCase();
        if (!state[sym]) state[sym] = { lots: [], currency: e.currency || "USD" };

        if (e.eventType === 'transaction') {
            state[sym].currency = e.currency;
            if (e.type === 'buy') {
                const fx = findFxRate(market, e.currency, toDate(e.date));
                const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);
                state[sym].lots.push({
                    quantity: e.quantity,
                    pricePerShareTWD: costTWD / (e.quantity || 1),
                    pricePerShareOriginal: e.price,
                    date: toDate(e.date)
                });
            } else {
                let sellQty = e.quantity;
                while (sellQty > 0 && state[sym].lots.length > 0) {
                    const lot = state[sym].lots[0];
                    if (lot.quantity <= sellQty) {
                        sellQty -= lot.quantity;
                        state[sym].lots.shift();
                    } else {
                        lot.quantity -= sellQty;
                        sellQty = 0;
                    }
                }
            }
        } else if (e.eventType === 'split') {
            state[sym].lots.forEach(lot => {
                lot.quantity *= e.ratio;
                lot.pricePerShareTWD /= e.ratio;
                lot.pricePerShareOriginal /= e.ratio;
            });
        }
    }
    return state;
}

function dailyValue(state, market, date, allEvts) {
    return Object.keys(state).reduce((totalValue, sym) => {
        const s = state[sym];
        const qty = s.lots.reduce((sum, lot) => sum + lot.quantity, 0);
        if (qty < 1e-9) return totalValue;

        let price = findNearest(market[sym]?.prices, date);
        if (price === undefined) {
            const yesterday = new Date(date);
            yesterday.setDate(yesterday.getDate() - 1);
            const firstLotDate = s.lots.length > 0 ? toDate(s.lots[0].date) : date;
            if (yesterday < firstLotDate) return totalValue;
            // This recursive call could be slow, but it's a fallback.
            return totalValue + dailyValue({ [sym]: s }, market, yesterday, allEvts);
        }

        const futureSplits = allEvts.filter(e =>
            e.eventType === 'split' &&
            e.symbol.toUpperCase() === sym.toUpperCase() &&
            toDate(e.date) > toDate(date)
        );
        const adjustmentRatio = futureSplits.reduce((acc, split) => acc * split.ratio, 1);
        const unadjustedPrice = price * adjustmentRatio;

        const fx = findFxRate(market, s.currency, date);
        return totalValue + (qty * unadjustedPrice * (s.currency === "TWD" ? 1 : fx));
    }, 0);
}

function prepareEvents(txs, splits, market, userDividends) {
    const firstBuyDateMap = {};
    txs.forEach(tx => {
        if (tx.type === "buy") {
            const sym = tx.symbol.toUpperCase();
            const d = toDate(tx.date);
            if (!firstBuyDateMap[sym] || d < firstBuyDateMap[sym]) {
                firstBuyDateMap[sym] = d;
            }
        }
    });

    const evts = [
        ...txs.map(t => ({ ...t, eventType: "transaction" })),
        ...splits.map(s => ({ ...s, eventType: "split" }))
    ];

    const confirmedDividendKeys = new Set(
        userDividends.map(d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`)
    );

    userDividends.forEach(ud => {
        evts.push({
            eventType: 'confirmed_dividend',
            date: toDate(ud.pay_date),
            symbol: ud.symbol.toUpperCase(),
            amount: ud.total_amount,
            currency: ud.currency,
        });
    });

    Object.keys(market).forEach(sym => {
        if (market[sym] && market[sym].dividends) {
            Object.entries(market[sym].dividends).forEach(([dateStr, amount]) => {
                const dividendDate = toDate(dateStr);
                const dividendKey = `${sym.toUpperCase()}_${dateStr}`;
                if (confirmedDividendKeys.has(dividendKey)) {
                    return; 
                }
                
                if (firstBuyDateMap[sym] && dividendDate >= firstBuyDateMap[sym] && amount > 0) {
                    const payDate = new Date(dividendDate);
                    payDate.setMonth(payDate.getMonth() + 1);
                    
                    evts.push({ 
                        eventType: "implicit_dividend", 
                        date: payDate,
                        ex_date: dividendDate, // Keep original ex-date for state calculation
                        symbol: sym.toUpperCase(), 
                        amount_per_share: amount 
                    });
                }
            });
        }
    });

    evts.sort((a, b) => toDate(a.date) - toDate(b.date));
    const firstTx = evts.find(e => e.eventType === 'transaction');
    return { evts, firstBuyDate: firstTx ? toDate(firstTx.date) : null };
}

function calculateDailyPortfolioValues(evts, market, startDate) {
    if (!startDate) return {};
    let curDate = new Date(startDate);
    curDate.setUTCHours(0, 0, 0, 0);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const history = {};
    while (curDate <= today) {
        const dateStr = curDate.toISOString().split("T")[0];
        const stateOnDate = getPortfolioStateOnDate(evts, curDate, market);
        history[dateStr] = dailyValue(stateOnDate, market, curDate, evts);
        curDate.setDate(curDate.getDate() + 1);
    }
    return history;
}

// [修正] TWR 現金流計算邏輯
function calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, startDate, log = console.log) {
    const dates = Object.keys(dailyPortfolioValues).sort();
    if (!startDate || dates.length === 0) return { twrHistory: {}, benchmarkHistory: {} };
    
    const upperBenchmarkSymbol = benchmarkSymbol.toUpperCase();
    const benchmarkPrices = market[upperBenchmarkSymbol]?.prices || {};
    const benchmarkCurrency = isTwStock(upperBenchmarkSymbol) ? "TWD" : "USD";
    const startFxRate = findFxRate(market, benchmarkCurrency, startDate);
    const benchmarkStartPriceOriginal = findNearest(benchmarkPrices, startDate);
    
    if (!benchmarkStartPriceOriginal) {
        log(`TWR_CALC_FAIL: Cannot find start price for benchmark ${upperBenchmarkSymbol}.`);
        return { twrHistory: {}, benchmarkHistory: {} };
    }
    const benchmarkStartPriceTWD = benchmarkStartPriceOriginal * startFxRate;
    
    const cashflows = evts.reduce((acc, e) => {
        const dateStr = toDate(e.date).toISOString().split('T')[0];
        let flow = 0;
        
        if (e.eventType === 'transaction') {
            const currency = e.currency || 'USD';
            const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, toDate(e.date));
            const cost = getTotalCost(e);
            flow = (e.type === 'buy' ? 1 : -1) * cost * (currency === 'TWD' ? 1 : fx);
        } else if (e.eventType === 'confirmed_dividend') {
            const fx = findFxRate(market, e.currency, toDate(e.date));
            flow = -1 * e.amount * (e.currency === 'TWD' ? 1 : fx); // amount is already post-tax
        } else if (e.eventType === 'implicit_dividend') {
            const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market);
            const shares = stateOnDate[e.symbol.toUpperCase()]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0;
            if (shares > 0) {
                const currency = stateOnDate[e.symbol.toUpperCase()]?.currency || 'USD';
                const fx = findFxRate(market, currency, toDate(e.date));
                const taxRate = isTwStock(e.symbol) ? 0.0 : 0.30;
                const postTaxAmount = e.amount_per_share * (1 - taxRate);
                flow = -1 * postTaxAmount * shares * fx;
            }
        }

        if (flow !== 0) {
            acc[dateStr] = (acc[dateStr] || 0) + flow;
        }
        return acc;
    }, {});
    
    const twrHistory = {};
    const benchmarkHistory = {};
    let cumulativeHpr = 1;
    let lastMarketValue = 0;
    
    for (const dateStr of dates) {
        const MVE = dailyPortfolioValues[dateStr];
        const CF = cashflows[dateStr] || 0;
        const denominator = lastMarketValue + CF;
        if (denominator !== 0) {
            const periodReturn = MVE / denominator;
            cumulativeHpr *= periodReturn;
        }
        twrHistory[dateStr] = (cumulativeHpr - 1) * 100;
        lastMarketValue = MVE;
        
        const currentBenchPriceOriginal = findNearest(benchmarkPrices, new Date(dateStr));
        if (currentBenchPriceOriginal && benchmarkStartPriceTWD > 0) {
            const currentFxRate = findFxRate(market, benchmarkCurrency, new Date(dateStr));
            const currentBenchPriceTWD = currentBenchPriceOriginal * currentFxRate;
            benchmarkHistory[dateStr] = ((currentBenchPriceTWD / benchmarkStartPriceTWD) - 1) * 100;
        }
    }
    return { twrHistory, benchmarkHistory };
}

function calculateFinalHoldings(pf, market, allEvts) {
    const holdingsToUpdate = {};
    const today = new Date();
    for (const sym in pf) {
        const h = pf[sym];
        const qty = h.lots.reduce((s, l) => s + l.quantity, 0);
        if (qty > 1e-9) {
            const totCostTWD = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareTWD, 0);
            const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0);
            const priceHist = market[sym]?.prices || {};
            const curPrice = findNearest(priceHist, today);
            const fx = findFxRate(market, h.currency, today);

            const futureSplits = allEvts.filter(e => e.eventType === 'split' && e.symbol.toUpperCase() === sym.toUpperCase() && toDate(e.date) > today);
            const adjustmentRatio = futureSplits.reduce((acc, split) => acc * split.ratio, 1);
            const unadjustedPrice = (curPrice ?? 0) * adjustmentRatio;

            const mktVal = qty * unadjustedPrice * (h.currency === "TWD" ? 1 : fx);
            const unreal = mktVal - totCostTWD;
            const rrCurrent = totCostTWD > 0 ? (unreal / totCostTWD) * 100 : 0;
            holdingsToUpdate[sym] = {
                symbol: sym,
                quantity: qty,
                currency: h.currency,
                avgCostOriginal: totCostOrg > 0 ? totCostOrg / qty : 0,
                totalCostTWD: totCostTWD,
                currentPriceOriginal: unadjustedPrice,
                marketValueTWD: mktVal,
                unrealizedPLTWD: unreal,
                realizedPLTWD: h.realizedPLTWD,
                returnRate: rrCurrent
            };
        }
    }
    return { holdingsToUpdate };
}

// [修正] XIRR 現金流計算邏輯
function createCashflowsForXirr(evts, holdings, market) {
    const flows = [];
    evts.forEach(e => {
        let amt = 0;
        let flowDate = toDate(e.date);

        if (e.eventType === "transaction") {
            const currency = e.currency || 'USD';
            const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, flowDate);
            const cost = getTotalCost(e);
            amt = e.type === "buy" ? -cost : cost;
            amt *= (currency === 'TWD' ? 1 : fx);
        } else if (e.eventType === "confirmed_dividend") {
            const fx = findFxRate(market, e.currency, flowDate);
            amt = e.amount * (e.currency === 'TWD' ? 1 : fx); // amount is post-tax
        } else if (e.eventType === "implicit_dividend") {
            const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market);
            const sym = e.symbol.toUpperCase();
            const currency = stateOnDate[sym]?.currency || 'USD';
            const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
            if (shares > 0) {
                const fx = findFxRate(market, currency, flowDate);
                const taxRate = isTwStock(sym) ? 0.0 : 0.30;
                const postTaxAmount = e.amount_per_share * (1 - taxRate);
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
        // Add a safeguard for guess becoming too negative
        if (1 + guess <= 0) {
            guess = guess / -2; 
            continue;
        }
        npv = amounts.reduce((sum, amount, j) => sum + amount / Math.pow(1 + guess, years[j]), 0);
        if (Math.abs(npv) < 1e-6) return guess;
        
        const derivative = amounts.reduce((sum, amount, j) => {
             if (1 + guess === 0 && years[j] + 1 > 0) return sum; // Avoid division by zero
             return sum - years[j] * amount / Math.pow(1 + guess, years[j] + 1);
        }, 0);

        if (Math.abs(derivative) < 1e-9) break; 
        guess -= npv / derivative;
    }
    return (npv && Math.abs(npv) < 1e-6) ? guess : null;
}

// [修正] calculateCoreMetrics 函式，修正 switch 語法錯誤
function calculateCoreMetrics(evts, market) {
    const pf = {};
    let totalRealizedPL = 0;

    for (const e of evts) {
        const sym = e.symbol.toUpperCase();
        if (!pf[sym]) pf[sym] = { lots: [], currency: e.currency || "USD", realizedPLTWD: 0, realizedCostTWD: 0 };

        switch (e.eventType) {
            case "transaction": {
                const fx = (e.exchangeRate && e.currency !== 'TWD') ? e.exchangeRate : findFxRate(market, e.currency, toDate(e.date));
                const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);
                if (e.type === "buy") {
                    pf[sym].lots.push({ quantity: e.quantity, pricePerShareOriginal: e.price, pricePerShareTWD: costTWD / (e.quantity || 1), date: toDate(e.date) });
                } else {
                    let sellQty = e.quantity;
                    const saleProceedsTWD = costTWD;
                    let costOfGoodsSoldTWD = 0;
                    while (sellQty > 0 && pf[sym].lots.length > 0) {
                        const lot = pf[sym].lots[0];
                        const qtyToSell = Math.min(sellQty, lot.quantity);
                        costOfGoodsSoldTWD += qtyToSell * lot.pricePerShareTWD;
                        lot.quantity -= qtyToSell;
                        sellQty -= qtyToSell;
                        if (lot.quantity < 1e-9) pf[sym].lots.shift();
                    }
                    const realized = saleProceedsTWD - costOfGoodsSoldTWD;
                    totalRealizedPL += realized;
                    pf[sym].realizedCostTWD += costOfGoodsSoldTWD;
                    pf[sym].realizedPLTWD += realized;
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
                const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market); // Use ex_date to check holding
                const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
                if (shares > 0) {
                    const currency = stateOnDate[sym]?.currency || 'USD';
                    const fx = findFxRate(market, currency, toDate(e.date)); // Use pay_date for fx rate
                    const taxRate = isTwStock(sym) ? 0.0 : 0.30;
                    const postTaxAmount = e.amount_per_share * (1 - taxRate);
                    const divTWD = postTaxAmount * shares * (currency === "TWD" ? 1 : fx);
                    
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

async function performRecalculation(uid) {
    console.log(`--- [${uid}] 重新計算程序開始 (v2.8.1) ---`);
    try {
        const [txs, splits, controlsData, userDividends] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
        ]);

        if (txs.length === 0) {
            await d1Client.batch([
                { sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM user_dividends WHERE uid = ?', params: [uid] }, // Also clear confirmed dividends
            ]);
            console.log(`[${uid}] 沒有交易紀錄，已清空相關資料。`);
            return;
        }

        const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';
        const symbolsInPortfolio = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
        const currencies = [...new Set(txs.map(t => t.currency))].filter(c => c !== "TWD");
        const fxSymbols = currencies.map(c => currencyToFx[c]).filter(Boolean);
        const allRequiredSymbols = [...new Set([...symbolsInPortfolio, ...fxSymbols, benchmarkSymbol.toUpperCase()])].filter(Boolean);
        const firstDate = txs[0].date.split('T')[0];

        await Promise.all(allRequiredSymbols.map(symbol => ensureDataCoverage(symbol, firstDate)));
        console.log(`[${uid}] 所有金融商品的數據覆蓋範圍已確認完畢。`);

        const market = await getMarketDataFromDb(txs, benchmarkSymbol);
        const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);
        if (!firstBuyDate) { 
            console.log(`[${uid}] 找不到首次交易日期，計算中止。`);
            return; 
        }

        const portfolioResult = calculateCoreMetrics(evts, market);
        const dailyPortfolioValues = calculateDailyPortfolioValues(evts, market, firstBuyDate);
        const { twrHistory, benchmarkHistory } = calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, firstBuyDate);
        const { holdingsToUpdate } = portfolioResult.holdings;
        
        const dbOps = [];
        dbOps.push({ sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] });
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
            benchmarkSymbol: benchmarkSymbol,
        };
      
        const summaryOps = [
            { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
            {
                sql: `INSERT INTO portfolio_summary (uid, summary_data, history, twrHistory, benchmarkHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?)`,
                params: [uid, JSON.stringify(summaryData), JSON.stringify(dailyPortfolioValues), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), new Date().toISOString()]
            }
        ];
    
        await d1Client.batch(summaryOps);
        console.log(`[${uid}] Summary data updated successfully.`);
    
        const BATCH_SIZE = 900;
        const dbOpsChunks = [];
        for (let i = 0; i < dbOps.length; i += BATCH_SIZE) {
            dbOpsChunks.push(dbOps.slice(i, i + BATCH_SIZE));
        }
    
        console.log(`[${uid}] Holdings data will be updated in ${dbOpsChunks.length} batches.`);
    
        await Promise.all(
            dbOpsChunks.map((chunk, index) => {
                console.log(`[${uid}] Executing holdings batch #${index + 1}...`);
                return d1Client.batch(chunk);
            })
        );
        
        console.log(`--- [${uid}] 重新計算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 計算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

// --- API 端點處理 ---
exports.unifiedPortfolioHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY, Authorization, X-Service-Account-Key');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const apiKey = req.headers['x-api-key'];
    if (apiKey !== D1_API_KEY) {
        return res.status(401).send({ success: false, message: 'Unauthorized: Invalid API Key' });
    }

    const serviceAccountKey = req.headers['x-service-account-key'];
    if (serviceAccountKey && serviceAccountKey === process.env.SERVICE_ACCOUNT_KEY) {
        const { action } = req.body;
        if (action === 'recalculate_all_users') {
            try {
                console.log('[Service Account] 收到全體使用者重算請求...');
                const allUidsResult = await d1Client.query('SELECT DISTINCT uid FROM transactions');
                const allUids = allUidsResult.map(row => row.uid);
                
                console.log(`[Service Account] 將為 ${allUids.length} 位使用者進行重算。`);
                for (const uid of allUids) {
                    await performRecalculation(uid);
                }
                
                return res.status(200).send({ success: true, message: '所有使用者重算成功。' });
            } catch (error) {
                console.error('[Service Account] 重算過程中發生錯誤:', error);
                return res.status(500).send({ success: false, message: `重算過程中發生錯誤: ${error.message}` });
            }
        }
        return res.status(400).send({ success: false, message: '無效的服務操作。' });
    }

    await verifyFirebaseToken(req, res, async () => {
        try {
            const uid = req.user.uid; 
            const { action, data } = req.body;

            if (!action) {
                return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });
            }

            switch (action) {
                case 'get_data': {
                    const [txs, splits, holdingsResult, summaryResult, stockNotes] = await Promise.all([
                        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
                        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
                        d1Client.query('SELECT * FROM holdings WHERE uid = ? ORDER BY marketValueTWD DESC', [uid]),
                        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ?', [uid]),
                        d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
                    ]);

                    const summaryRow = summaryResult[0] || {};
                    const summary = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
                    const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
                    const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
                    const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
                    
                    const benchmarkSymbol = summary.benchmarkSymbol || 'SPY';
                    // We don't fetch full market data here to keep it fast.
                    // The main portfolio data is sufficient for the initial load.
                    
                    return res.status(200).send({
                        success: true,
                        data: {
                            summary,
                            holdings: holdingsResult,
                            transactions: txs,
                            splits,
                            stockNotes,
                            history, twrHistory, benchmarkHistory,
                        }
                    });
                }

                case 'add_transaction':
                case 'edit_transaction': {
                    try {
                        const isEditing = action === 'edit_transaction';
                        const txData = transactionSchema.parse(isEditing ? data.txData : data);
                        const txId = isEditing ? data.txId : uuidv4();

                        if (isEditing) {
                            await d1Client.query(
                                `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
                                [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
                            );
                        } else {
                            await d1Client.query(
                                `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
                            );
                        }
                        
                        await performRecalculation(uid);
                        return res.status(200).send({ success: true, message: '操作成功並觸發重新計算。', id: txId });

                    } catch (error) {
                        if (error instanceof z.ZodError) {
                            console.warn(`[Validation Error] for ${action}:`, error.errors);
                            return res.status(400).send({ success: false, message: "輸入資料格式錯誤", errors: error.errors });
                        }
                        throw error;
                    }
                }
                
                // ... delete_transaction, update_benchmark, add_split, delete_split, etc. are identical to the user's provided version...
                // To save space as requested, I will provide the new ones.
                
                case 'get_dividends_for_management': {
                    const [txs, allDividendsHistory, userDividends] = await Promise.all([
                        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
                        d1Client.query('SELECT * FROM dividend_history ORDER BY date ASC'),
                        d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid])
                    ]);

                    if (txs.length === 0) {
                        return res.status(200).send({ success: true, data: { pendingDividends: [], confirmedDividends: userDividends } });
                    }
                    
                    // [修正] 更高效的持股檢查演算法
                    const holdings = {}; // { AAPL: 10, GOOG: 20 }
                    const txTimeline = [...txs].sort((a, b) => new Date(a.date) - new Date(b.date));
                    let txIndex = 0;
                    
                    const confirmedKeys = new Set(userDividends.map(d => `${d.symbol}_${d.ex_dividend_date.split('T')[0]}`));
                    const pendingDividends = [];

                    const uniqueSymbolsInTxs = [...new Set(txs.map(t => t.symbol))];

                    allDividendsHistory.forEach(histDiv => {
                        const divSymbol = histDiv.symbol;
                        if (!uniqueSymbolsInTxs.includes(divSymbol)) return;

                        const exDateStr = histDiv.date.split('T')[0];
                        if (confirmedKeys.has(`${divSymbol}_${exDateStr}`)) return;
                        
                        const exDateMinusOne = new Date(exDateStr);
                        exDateMinusOne.setDate(exDateMinusOne.getDate() - 1);

                        // 快轉交易紀錄到除息日前一天
                        while(txIndex < txTimeline.length && new Date(txTimeline[txIndex].date) <= exDateMinusOne) {
                            const tx = txTimeline[txIndex];
                            holdings[tx.symbol] = (holdings[tx.symbol] || 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity);
                            txIndex++;
                        }
                        
                        const quantity = holdings[divSymbol] || 0;

                        if (quantity > 0) {
                             const currency = txs.find(t => t.symbol === divSymbol)?.currency || (isTwStock(divSymbol) ? 'TWD' : 'USD');
                             pendingDividends.push({
                                symbol: divSymbol,
                                ex_dividend_date: exDateStr,
                                amount_per_share: histDiv.dividend,
                                quantity_at_ex_date: quantity,
                                currency: currency
                             });
                        }
                    });
                    
                    return res.status(200).send({
                        success: true,
                        data: {
                            pendingDividends: pendingDividends.sort((a,b) => new Date(b.ex_dividend_date) - new Date(a.ex_dividend_date)),
                            confirmedDividends: userDividends
                        }
                    });
                }

                case 'save_user_dividend': {
                    const parsedData = userDividendSchema.parse(data);
                    const { id, ...divData } = parsedData;
                    const dividendId = id || uuidv4();

                    if (id) {
                        await d1Client.query(
                            `UPDATE user_dividends SET pay_date = ?, total_amount = ?, tax_rate = ?, notes = ? WHERE id = ? AND uid = ?`,
                            [divData.pay_date, divData.total_amount, divData.tax_rate, divData.notes, id, uid]
                        );
                    } else {
                        await d1Client.query(
                            `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
                            [dividendId, uid, divData.symbol, divData.ex_dividend_date, divData.pay_date, divData.amount_per_share, divData.quantity_at_ex_date, divData.total_amount, divData.tax_rate, divData.currency, divData.notes]
                        );
                    }
                    await performRecalculation(uid);
                    return res.status(200).send({ success: true, message: '配息紀錄已儲存。' });
                }

                case 'bulk_confirm_all_dividends': {
                    const pendingDividends = data.pendingDividends || [];
                    if (pendingDividends.length === 0) {
                        return res.status(200).send({ success: true, message: '沒有需要批次確認的配息。' });
                    }

                    const dbOps = [];
                    for (const pending of pendingDividends) {
                        const payDate = new Date(pending.ex_dividend_date);
                        payDate.setMonth(payDate.getMonth() + 1);
                        const payDateStr = payDate.toISOString().split('T')[0];

                        const taxRate = isTwStock(pending.symbol) ? 0.0 : 0.30;
                        const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate);

                        dbOps.push({
                            sql: `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '批次確認')`,
                            params: [uuidv4(), uid, pending.symbol, pending.ex_dividend_date, payDateStr, pending.amount_per_share, pending.quantity_at_ex_date, totalAmount, taxRate * 100, pending.currency]
                        });
                    }

                    if (dbOps.length > 0) {
                        await d1Client.batch(dbOps);
                        await performRecalculation(uid);
                    }

                    return res.status(200).send({ success: true, message: `成功批次確認 ${dbOps.length} 筆配息紀錄。` });
                }

                case 'delete_user_dividend': {
                    const { dividendId } = data;
                    if (!dividendId) return res.status(400).send({ success: false, message: '請求錯誤：缺少 dividendId。' });
                    await d1Client.query('DELETE FROM user_dividends WHERE id = ? AND uid = ?', [dividendId, uid]);
                    await performRecalculation(uid);
                    return res.status(200).send({ success: true, message: '配息紀錄已刪除。' });
                }
                
                // ... other cases like 'clear_user_data', 'migrate_user_data', note handlers etc.
                // These are unchanged from your version.

                default:
                    return res.status(400).send({ success: false, message: '未知的操作' });
            }
        } catch (error) {
            const errorMessage = error.message || 'An unknown error occurred.';
            console.error(`[${req.user?.uid || 'N/A'}] 在執行 action: '${req.body?.action}' 時發生錯誤:`, error);
            if (error instanceof z.ZodError) {
                 return res.status(400).send({ success: false, message: "輸入資料格式驗證失敗", errors: error.errors });
            }
            res.status(500).send({ success: false, message: `伺服器內部錯誤：${errorMessage}` });
        }
    });
});
