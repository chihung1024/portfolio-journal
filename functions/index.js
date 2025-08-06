/* eslint-disable */
// =========================================================================================
// == GCP Cloud Function 完整程式碼 (v2.5.0 - 新增資料轉移功能)
// =========================================================================================

const functions = require("firebase-functions");
const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');

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
    const fxSymbols = currencies.map(c => currencyToFx[c]).filter(Boolean);
    const allRequiredSymbols = [...new Set([...symbolsInPortfolio, ...fxSymbols, benchmarkSymbol.toUpperCase()])].filter(Boolean);

    console.log(`[DB Read] 開始從 D1 讀取市場數據，目標標的: ${allRequiredSymbols.join(', ')}`);
    const marketData = {};
    for (const s of allRequiredSymbols) {
        const isFx = s.includes("=");
        const priceTable = isFx ? "exchange_rates" : "price_history";
        const divTable = "dividend_history";

        const priceData = await d1Client.query(`SELECT date, price FROM ${priceTable} WHERE symbol = ?`, [s]);
        
        marketData[s] = {
            prices: priceData.reduce((acc, row) => { acc[row.date.split('T')[0]] = row.price; return acc; }, {}),
            dividends: {}
        };

        if (isFx) {
            marketData[s].rates = marketData[s].prices;
        } else {
            const divData = await d1Client.query(`SELECT date, dividend FROM ${divTable} WHERE symbol = ?`, [s]);
            marketData[s].dividends = divData.reduce((acc, row) => { acc[row.date.split('T')[0]] = row.dividend; return acc; }, {});
        }
    }
    console.log("[DB Read] 所有市場數據已從 D1 載入記憶體。");
    return marketData;
}


// --- 核心計算與輔助函式 (此區塊無變動) ---
const toDate = v => v ? (v.toDate ? v.toDate() : new Date(v)) : null;
const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };

const isTwStock = (symbol) => {
    if (!symbol) return false;
    const upperSymbol = symbol.toUpperCase();
    return upperSymbol.endsWith('.TW') || upperSymbol.endsWith('.TWO');
};

const getTotalCost = (tx) => {
    return (tx.totalCost !== undefined && tx.totalCost !== null)
        ? Number(tx.totalCost)
        : Number(tx.price || 0) * Number(tx.quantity || 0);
};

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

function prepareEvents(txs, splits, market) {
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

    Object.keys(market).forEach(sym => {
        if (market[sym] && market[sym].dividends) {
            Object.entries(market[sym].dividends).forEach(([dateStr, amount]) => {
                const dividendDate = new Date(dateStr);
                dividendDate.setUTCHours(0, 0, 0, 0);
                if (firstBuyDateMap[sym] && dividendDate >= firstBuyDateMap[sym] && amount > 0) {
                    evts.push({ date: dividendDate, symbol: sym, amount, eventType: "dividend" });
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
        const currency = e.currency || market[e.symbol.toUpperCase()]?.currency || 'USD';
        let fx;
        if (e.eventType === 'transaction' && e.exchangeRate && e.currency !== 'TWD') {
            fx = e.exchangeRate;
        } else {
            fx = findFxRate(market, currency, toDate(e.date));
        }
        if (e.eventType === 'transaction') {
            const cost = getTotalCost(e);
            flow = (e.type === 'buy' ? 1 : -1) * cost * (currency === 'TWD' ? 1 : fx);
        } else if (e.eventType === 'dividend') {
            const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.date), market);
            const shares = stateOnDate[e.symbol.toUpperCase()]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0;
            if (shares > 0) {
                const taxRate = isTwStock(e.symbol) ? 0.0 : 0.30;
                const postTaxAmount = e.amount * (1 - taxRate);
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
function createCashflowsForXirr(evts, holdings, market) {
    const flows = [];
    evts.filter(e => e.eventType === "transaction").forEach(t => {
        let fx;
        if (t.exchangeRate && t.currency !== 'TWD') {
            fx = t.exchangeRate;
        } else {
            fx = findFxRate(market, t.currency, toDate(t.date));
        }
        const amt = getTotalCost(t) * (t.currency === "TWD" ? 1 : fx);
        flows.push({ date: toDate(t.date), amount: t.type === "buy" ? -amt : amt });
    });
    evts.filter(e => e.eventType === "dividend").forEach(d => {
        const stateOnDate = getPortfolioStateOnDate(evts, toDate(d.date), market);
        const sym = d.symbol.toUpperCase();
        const currency = stateOnDate[sym]?.currency || 'USD';
        const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
        if (shares > 0) {
            const fx = findFxRate(market, currency, toDate(d.date));
            const taxRate = isTwStock(sym) ? 0.0 : 0.30;
            const postTaxAmount = d.amount * (1 - taxRate);
            const amt = postTaxAmount * shares * (currency === "TWD" ? 1 : fx);
            flows.push({ date: toDate(d.date), amount: amt });
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
        if (1 + guess <= 0) {
            guess = guess / -2;
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
function calculateCoreMetrics(evts, market) {
    const pf = {};
    let totalRealizedPL = 0;
    for (const e of evts) {
        const sym = e.symbol.toUpperCase();
        if (!pf[sym]) pf[sym] = { lots: [], currency: e.currency || "USD", realizedPLTWD: 0, realizedCostTWD: 0 };
        switch (e.eventType) {
            case "transaction": {
                let fx;
                if (e.exchangeRate && e.currency !== 'TWD') {
                    fx = e.exchangeRate;
                } else {
                    fx = findFxRate(market, e.currency, toDate(e.date));
                }
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
            case "split":
                pf[sym].lots.forEach(l => {
                    l.quantity *= e.ratio;
                    l.pricePerShareTWD /= e.ratio;
                    l.pricePerShareOriginal /= e.ratio;
                });
                break;
            case "dividend": {
                const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.date), market);
                const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
                if (shares > 0) {
                    const fx = findFxRate(market, pf[sym].currency, toDate(e.date));
                    const taxRate = isTwStock(sym) ? 0.0 : 0.30;
                    const postTaxAmount = e.amount * (1 - taxRate);
                    const divTWD = postTaxAmount * shares * (pf[sym].currency === "TWD" ? 1 : fx);
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
    console.log(`--- [${uid}] 重新計算程序開始 (v2.4.0) ---`);
    try {
        const [txs, splits, controlsData] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol'])
        ]);

        if (txs.length === 0) {
            console.log(`[${uid}] 沒有交易紀錄，清空相關資料並結束。`);
            await d1Client.batch([
                { sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
            ]);
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
        const { evts, firstBuyDate } = prepareEvents(txs, splits, market);
        if (!firstBuyDate) { return; }

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
        const finalBatch = [
            { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
            {
                sql: `INSERT INTO portfolio_summary (uid, summary_data, history, twrHistory, benchmarkHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?)`,
                params: [uid, JSON.stringify(summaryData), JSON.stringify(dailyPortfolioValues), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), new Date().toISOString()]
            },
            ...dbOps
        ];
        await d1Client.batch(finalBatch);
        console.log(`--- [${uid}] 重新計算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 計算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

// --- API 端點處理 ---
exports.unifiedPortfolioHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY'); res.set('Access-Control-Max-Age', '3600'); res.status(204).send(''); return; }
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== D1_API_KEY) return res.status(401).send('Unauthorized');

    const { action, uid, data } = req.body;
    if (!action) return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });

    try {
        switch (action) {
            case 'get_data': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const [txs, splits] = await Promise.all([
                    d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
                    d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid])
                ]);
                const [summaryResult, holdingsResult] = await Promise.all([
                    d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ?', [uid]),
                    d1Client.query('SELECT * FROM holdings WHERE uid = ? ORDER BY marketValueTWD DESC', [uid])
                ]);
                const summaryRow = summaryResult[0] || {};
                const summary = summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {};
                const history = summaryRow.history ? JSON.parse(summaryRow.history) : {};
                const twrHistory = summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {};
                const benchmarkHistory = summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {};
                
                const benchmarkSymbol = summary.benchmarkSymbol || 'SPY';
                const marketData = await getMarketDataFromDb(txs, benchmarkSymbol);

                return res.status(200).send({
                    success: true,
                    data: {
                        summary,
                        holdings: holdingsResult,
                        transactions: txs,
                        splits,
                        history, twrHistory, benchmarkHistory,
                        marketData
                    }
                });
            }

            case 'add_transaction':
            case 'edit_transaction': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const isEditing = action === 'edit_transaction';
                const txData = isEditing ? data.txData : data;
                const txId = isEditing ? data.txId : uuidv4();

                if(isEditing) {
                    await d1Client.query(
                        `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
                        [txData.date, txData.symbol.toUpperCase(), txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
                    );
                } else {
                    await d1Client.query(
                        `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [txId, uid, txData.date, txData.symbol.toUpperCase(), txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
                    );
                }
                
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: '操作成功並觸發重新計算。', id: txId });
            }

            case 'delete_transaction': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const { txId } = data;
                if (!txId) return res.status(400).send({ success: false, message: '請求錯誤：缺少 txId。' });
                await d1Client.query('DELETE FROM transactions WHERE id = ? AND uid = ?', [txId, uid]);
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: '交易已刪除並觸發重新計算。' });
            }

            case 'update_benchmark': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const { benchmarkSymbol } = data;
                if (!benchmarkSymbol) return res.status(400).send({ success: false, message: '請求錯誤：缺少 benchmarkSymbol。' });
                
                await d1Client.query(
                    'INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)',
                    [uid, 'benchmarkSymbol', benchmarkSymbol.toUpperCase()]
                );
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: '基準已更新並觸發重新計算。' });
            }

            case 'add_split': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const { date, symbol, ratio } = data;
                if (!date || !symbol || !ratio) return res.status(400).send({ success: false, message: '請求錯誤：缺少拆股事件必要欄位。' });
                const newSplitId = uuidv4();
                await d1Client.query(`INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`, [newSplitId, uid, date, symbol.toUpperCase(), ratio]);
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: '分割事件已新增並觸發重新計算。', splitId: newSplitId });
            }
            case 'delete_split': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const { splitId } = data;
                if (!splitId) return res.status(400).send({ success: false, message: '請求錯誤：缺少 splitId。' });
                await d1Client.query('DELETE FROM splits WHERE id = ? AND uid = ?', [splitId, uid]);
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: '分割事件已刪除並觸發重新計算。' });
            }
            case 'recalculate': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: `${uid} 的重新計算成功` });
            }
            
            case 'clear_user_data': {
                if (!uid) {
                    return res.status(400).send({ success: false, message: '請求錯誤：清除使用者資料必須提供 uid。' });
                }
                console.warn(`[DANGER] 即將開始刪除使用者 ${uid} 的所有資料...`);
                const userTables = ['transactions', 'splits', 'holdings', 'portfolio_summary', 'controls'];
                const deleteOps = userTables.map(table => ({
                    sql: `DELETE FROM ${table} WHERE uid = ?`,
                    params: [uid]
                }));
                await d1Client.batch(deleteOps);
                console.log(`[SUCCESS] 已成功清除使用者 ${uid} 的所有資料。`);
                return res.status(200).send({ success: true, message: `已成功清除使用者 ${uid} 的所有資料。` });
            }

            case '__DANGEROUSLY_CLEAR_ENTIRE_DATABASE__': {
                console.warn(`[DANGER ZONE] 收到清空整個資料庫的請求！`);
                if (data?.confirm !== 'DELETE_ALL_DATA_NOW') {
                     return res.status(403).send({ success: false, message: '危險操作！請求被拒絕。請提供正確的確認訊息以清空整個資料庫。' });
                }

                const allTables = [
                    'transactions', 'splits', 'holdings', 'portfolio_summary', 'controls',
                    'price_history', 'dividend_history', 'exchange_rates', 'market_data_coverage'
                ];
                const deleteOps = allTables.map(table => ({
                    sql: `DELETE FROM ${table};`,
                    params: []
                }));
                
                await d1Client.batch(deleteOps);
                console.log(`[DANGER ZONE] 整個資料庫已被成功清空。`);
                return res.status(200).send({ success: true, message: '已成功清除資料庫中的所有資料。所有資料表結構已保留。' });
            }
            
            case 'migrate_user_data': {
                const { sourceUid, targetUid } = data;
                if (!sourceUid || !targetUid) {
                    return res.status(400).send({ success: false, message: '請求錯誤：轉移資料必須提供 sourceUid 和 targetUid。' });
                }
                if (sourceUid === targetUid) {
                    return res.status(400).send({ success: false, message: '請求錯誤：來源和目標 UID 不可相同。' });
                }

                console.log(`[MIGRATION] 開始將資料從 ${sourceUid} 轉移到 ${targetUid}...`);

                const userTables = ['transactions', 'splits', 'holdings', 'portfolio_summary', 'controls'];
                const updateOps = userTables.map(table => ({
                    sql: `UPDATE ${table} SET uid = ? WHERE uid = ?`,
                    params: [targetUid, sourceUid]
                }));

                await d1Client.batch(updateOps);
                
                console.log(`[MIGRATION] UID 更新完成。正在為新帳號 ${targetUid} 觸發重新計算...`);
                await performRecalculation(targetUid);

                console.log(`[MIGRATION] 資料轉移成功：從 ${sourceUid} 到 ${targetUid}。`);
                return res.status(200).send({ success: true, message: `已成功將資料從 ${sourceUid} 轉移到 ${targetUid}。` });
            }

            default:
                return res.status(400).send({ success: false, message: '未知的操作' });
        }
    } catch (error) {
        const errorMessage = error.message || 'An unknown error occurred.';
        console.error(`[${uid || 'N/A'}] '${action}' 操作的處理程序失敗：`, errorMessage);
        return res.status(500).send({ success: false, message: `發生內部錯誤：${errorMessage}` });
    }
});
```

### 2. 更新您的前端 (`index.html`)

請將您在 Canvas 中的 `admin_panel_html` 檔案，用以下這個 `v2.1` 版本的完整程式碼替換。它新增了臨時的管理面板。


```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>股票交易紀錄與資產分析系統 (Firebase 整合版)</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <script src="https://cdn.jsdelivr.net/npm/lucide@0.378.0/dist/umd/lucide.min.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', 'Noto Sans TC', sans-serif; background-color: #f0f2f5; }
        .card { background-color: white; border-radius: 0.75rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); transition: all 0.3s ease-in-out; }
        .btn { transition: all 0.2s ease-in-out; }
        .modal-backdrop { background-color: rgba(0,0,0,0.5); transition: opacity 0.3s ease; }
    </style>
</head>
<body class="text-gray-800">

    <div id="app" class="min-h-screen">
        <div id="notification-area" class="fixed top-5 right-5 z-50"></div>

        <header class="bg-white shadow-md sticky top-0 z-20">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                <div class="flex items-center space-x-3">
                    <i data-lucide="line-chart" class="text-indigo-600 h-8 w-8"></i>
                    <h1 class="text-2xl font-bold text-gray-800">交易紀錄與資產分析</h1>
                </div>
                <div id="auth-status-display" class="flex items-center space-x-4 text-xs text-gray-500 text-right">
                    <div id="user-info" class="hidden">
                        <span id="auth-status"></span>
                        <p id="user-id" class="truncate max-w-[150px] sm:max-w-xs"></p>
                    </div>
                    <button id="logout-btn" class="hidden btn bg-red-500 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-red-600">登出</button>
                </div>
            </div>
        </header>
        
        <div id="auth-container" class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
             <div class="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
                <h2 class="text-2xl font-bold text-center text-gray-800 mb-6">登入或註冊</h2>
                <form id="auth-form">
                    <div class="mb-4">
                        <label for="email" class="block text-sm font-medium text-gray-700 mb-1">電子郵件</label>
                        <input type="email" id="email" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required>
                    </div>
                    <div class="mb-6">
                        <label for="password" class="block text-sm font-medium text-gray-700 mb-1">密碼</label>
                        <input type="password" id="password" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required>
                    </div>
                    <div class="flex items-center justify-between space-x-4">
                        <button type="button" id="login-btn" class="w-full btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700">登入</button>
                        <button type="button" id="register-btn" class="w-full btn bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-gray-700">註冊</button>
                    </div>
                </form>
            </div>
        </div>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 hidden">
            <div id="loading-overlay" class="fixed inset-0 bg-white bg-opacity-75 flex items-center justify-center z-40" style="display: none;">
                <div class="flex flex-col items-center text-center p-4">
                    <svg class="animate-spin h-10 w-10 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <p id="loading-text" class="mt-4 text-lg font-medium text-gray-700">正在驗證您的身分...</p>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">總資產 (TWD)</h3><i data-lucide="wallet" class="h-6 w-6 text-gray-400"></i></div><p id="total-assets" class="text-3xl font-bold text-gray-800 mt-2">0</p></div>
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">未實現損益 (TWD)</h3><i data-lucide="trending-up" class="h-6 w-6 text-gray-400"></i></div><p id="unrealized-pl" class="text-3xl font-bold text-gray-800 mt-2">0</p></div>
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">已實現損益 (TWD)</h3><i data-lucide="dollar-sign" class="h-6 w-6 text-gray-400"></i></div><p id="realized-pl" class="text-3xl font-bold text-gray-800 mt-2">0</p></div>
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">總報酬率</h3><i data-lucide="percent" class="h-6 w-6 text-gray-400"></i></div><p id="total-return" class="text-3xl font-bold text-gray-800 mt-2">0.00%</p></div>
                <div class="card p-5 flex flex-col justify-between"><div class="flex items-center justify-between"><h3 class="text-sm font-medium text-gray-500">XIRR 年化報酬率</h3><i data-lucide="calendar-check" class="h-6 w-6 text-gray-400"></i></div><p id="xirr-value" class="text-3xl font-bold text-gray-800 mt-2">0.00%</p></div>
            </div>

            <div class="card p-6 mb-8">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <div class="sm:flex sm:items-center sm:space-x-4"><h2 class="text-xl font-bold text-gray-800">投資組合</h2><div class="mt-2 sm:mt-0 border-b sm:border-b-0 sm:border-l border-gray-200 sm:pl-4"><nav class="-mb-px flex space-x-6" id="tabs"><a href="#" data-tab="holdings" class="tab-item whitespace-nowrap border-b-2 font-medium text-sm border-indigo-500 text-indigo-600">持股一覽</a><a href="#" data-tab="transactions" class="tab-item whitespace-nowrap border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">交易紀錄</a><a href="#" data-tab="splits" class="tab-item whitespace-nowrap border-b-2 font-medium text-sm border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">拆股事件</a></nav></div></div>
                    <div class="flex space-x-2">
                        <button id="manage-splits-btn" class="btn bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-gray-700 flex items-center space-x-2"><i data-lucide="git-merge" class="h-5 w-5"></i><span>管理拆股</span></button>
                        <button id="add-transaction-btn" class="btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700 flex items-center space-x-2"><i data-lucide="plus-circle" class="h-5 w-5"></i><span>新增交易</span></button>
                    </div>
                </div>
                <div id="holdings-tab" class="tab-content overflow-x-auto"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">股數</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">平均成本(原幣)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">總成本(TWD)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">現價(原幣)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">市值(TWD)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">未實現損益(TWD)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">報酬率</th></tr></thead><tbody id="holdings-table-body" class="bg-white divide-y divide-gray-200"></tbody></table></div>
                <div id="transactions-tab" class="tab-content overflow-x-auto hidden"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">類型</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">股數</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">價格(原幣)</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">總金額(TWD)</th><th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th></tr></thead><tbody id="transactions-table-body" class="bg-white divide-y divide-gray-200"></tbody></table></div>
                <div id="splits-tab" class="tab-content overflow-x-auto hidden"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th><th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">比例</th><th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th></tr></thead><tbody id="splits-table-body" class="bg-white divide-y divide-gray-200"></tbody></table></div>
            </div>
            
            <div class="card p-6 mb-8">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                    <h3 class="text-lg font-semibold text-gray-800">時間加權報酬率 vs. Benchmark</h3>
                    <div class="flex items-center space-x-2">
                        <input type="text" id="benchmark-symbol-input" placeholder="e.g., SPY" class="w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                        <button id="update-benchmark-btn" class="btn bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 flex items-center space-x-2">
                            <i data-lucide="refresh-cw" class="h-5 w-5"></i>
                            <span>更新</span>
                        </button>
                    </div>
                </div>
                <div id="twr-chart"></div>
            </div>
            
            <div class="card p-6">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">資產成長曲線 (TWD)</h3>
                <div id="asset-chart"></div>
            </div>

            <!-- [新增] 臨時管理面板 -->
            <div id="admin-panel" class="card p-6 mt-8 border-2 border-red-500">
                <h3 class="text-lg font-bold text-red-700 mb-4">⚠️ 管理員操作面板 (開發測試用)</h3>
                <p class="text-sm text-gray-600 mb-4">轉移完成後，請務必刪除或隱藏此區塊，以策安全。</p>
                <div class="space-y-4">
                    <div>
                        <label for="source-uid" class="block text-sm font-medium text-gray-700">舊測試帳號 UID (來源)</label>
                        <input type="text" id="source-uid" class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" placeholder="例如：test-user-01" value="test-user-01">
                    </div>
                    <div>
                        <label for="target-uid" class="block text-sm font-medium text-gray-700">新註冊帳號 UID (目標)</label>
                        <input type="text" id="target-uid" class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm" placeholder="從 Firebase 控制台複製新使用者的 UID">
                    </div>
                    <div class="flex space-x-4">
                        <button id="migrate-btn" class="btn bg-orange-500 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-orange-600">轉移資料</button>
                        <p class="text-xs text-gray-500 self-center">此操作會將「來源 UID」的所有資料庫紀錄轉移給「目標 UID」。操作不可逆！</p>
                    </div>
                </div>
            </div>

        </main>

        <div id="transaction-modal" class="fixed inset-0 z-30 overflow-y-auto hidden"><div class="flex items-center justify-center min-h-screen"><div class="fixed inset-0 modal-backdrop" ></div><div class="bg-white rounded-lg shadow-xl p-8 z-40 w-full max-w-md mx-4"><h3 id="modal-title" class="text-2xl font-bold mb-6 text-gray-800">新增交易紀錄</h3><form id="transaction-form"><input type="hidden" id="transaction-id"><div class="mb-4"><label for="transaction-date" class="block text-sm font-medium text-gray-700 mb-1">日期</label><input type="date" id="transaction-date" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="mb-4"><label for="stock-symbol" class="block text-sm font-medium text-gray-700 mb-1">股票代碼</label><input type="text" id="stock-symbol" placeholder="例如: AAPL, 2330.TW" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="mb-4"><label class="block text-sm font-medium text-gray-700 mb-1">交易類型</label><div class="flex space-x-4"><label class="flex items-center"><input type="radio" name="transaction-type" value="buy" class="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500" checked><span class="ml-2 text-gray-700">買入</span></label><label class="flex items-center"><input type="radio" name="transaction-type" value="sell" class="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"><span class="ml-2 text-gray-700">賣出</span></label></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><div><label for="quantity" class="block text-sm font-medium text-gray-700 mb-1">股數</label><input type="number" step="any" id="quantity" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div><label for="price" class="block text-sm font-medium text-gray-700 mb-1">價格 (原幣)</label><input type="number" step="any" id="price" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div></div><div class="mb-4"><label for="currency" class="block text-sm font-medium text-gray-700 mb-1">幣別</label><select id="currency" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"><option value="USD">USD</option><option value="TWD">TWD</option><option value="HKD">HKD</option><option value="JPY">JPY</option></select></div>
                <div id="exchange-rate-field" class="space-y-4 mb-4 p-4 border border-gray-200 rounded-md" style="display: none;">
                    <label for="exchange-rate" class="block text-sm font-medium text-gray-700 mb-1">手動匯率 (選填)</label>
                    <input type="number" step="any" id="exchange-rate" placeholder="留空則自動抓取" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                </div>
                <div id="total-cost-field" class="space-y-4 mb-4 p-4 border border-gray-200 rounded-md">
                    <label for="total-cost" class="block text-sm font-medium text-gray-700 mb-1">總成本 (含費用, 原幣, 選填)</label>
                    <input type="number" step="any" id="total-cost" placeholder="留空則自動計算 (股數*價格)" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                </div>
                <div class="flex justify-end space-x-4 mt-6"><button type="button" id="cancel-btn" class="btn bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">取消</button><button type="submit" id="save-btn" class="btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700 flex items-center justify-center">儲存</button></div></form></div></div></div>
        <div id="split-modal" class="fixed inset-0 z-30 overflow-y-auto hidden"><div class="flex items-center justify-center min-h-screen"><div class="fixed inset-0 modal-backdrop"></div><div class="bg-white rounded-lg shadow-xl p-8 z-40 w-full max-w-md mx-4"><h3 class="text-2xl font-bold mb-6 text-gray-800">新增拆股/合股事件</h3><form id="split-form"><input type="hidden" id="split-id"><div class="mb-4"><label for="split-date" class="block text-sm font-medium text-gray-700 mb-1">日期</label><input type="date" id="split-date" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="mb-4"><label for="split-symbol" class="block text-sm font-medium text-gray-700 mb-1">股票代碼</label><input type="text" id="split-symbol" placeholder="例如: AAPL, 2330.TW" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="mb-4"><label for="split-ratio" class="block text-sm font-medium text-gray-700 mb-1">比例</label><input type="number" step="any" id="split-ratio" placeholder="1拆10, 輸入10; 10合1, 輸入0.1" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" required></div><div class="flex justify-end space-x-4 mt-6"><button type="button" id="cancel-split-btn" class="btn bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">取消</button><button type="submit" id="save-split-btn" class="btn bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700">儲存</button></div></form></div></div></div>
        <div id="confirm-modal" class="fixed inset-0 z-50 overflow-y-auto hidden"><div class="flex items-center justify-center min-h-screen"><div class="fixed inset-0 modal-backdrop"></div><div class="bg-white rounded-lg shadow-xl p-8 z-50 w-full max-w-sm mx-4"><h3 id="confirm-title" class="text-lg font-semibold mb-4 text-gray-800">確認操作</h3><p id="confirm-message" class="text-gray-600 mb-6">您確定要執行此操作嗎？</p><div class="flex justify-end space-x-4"><button id="confirm-cancel-btn" class="btn bg-gray-200 text-gray-700 font-bold py-2 px-4 rounded-lg hover:bg-gray-300">取消</button><button id="confirm-ok-btn" class="btn bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md hover:bg-red-700">確定</button></div></div></div></div>
    </div>
    
    <script type="module">
        import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
        import { 
            getAuth, 
            createUserWithEmailAndPassword, 
            signInWithEmailAndPassword, 
            signOut, 
            onAuthStateChanged 
        } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

        // =========================================================================================
        // == 前端 JavaScript 完整程式碼 (v2.1 - 轉移功能整合版)
        // =========================================================================================

        const firebaseConfig = {
            apiKey: "YOUR_API_KEY",
            authDomain: "YOUR_AUTH_DOMAIN",
            projectId: "YOUR_PROJECT_ID",
            storageBucket: "YOUR_STORAGE_BUCKET",
            messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
            appId: "YOUR_APP_ID"
        };

        const firebaseApp = initializeApp(firebaseConfig);
        const auth = getAuth(firebaseApp);

        const API = {
          URL: 'https://portfolio-journal-api-951186116587.asia-east1.run.app',
          KEY: 'QqcUhBV04KciA1xeDibpOmcLpAQWDt'
        };

        let currentUserId = null;
        let transactions = [];
        let userSplits = [];
        let marketDataForFrontend = {};
        let chart, twrChart;
        let confirmCallback = null;

        // --- Firebase 認證核心邏輯 ---
        
        onAuthStateChanged(auth, (user) => {
            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingText = document.getElementById('loading-text');

            if (user) {
                console.log("使用者已登入:", user.uid);
                currentUserId = user.uid;

                document.getElementById('auth-container').style.display = 'none';
                document.querySelector('main').classList.remove('hidden');
                document.getElementById('logout-btn').style.display = 'block';
                document.getElementById('user-info').classList.remove('hidden');
                document.getElementById('user-id').textContent = user.email;
                document.getElementById('auth-status').textContent = '已連線';
                
                loadingText.textContent = '正在從雲端同步資料...';
                loadPortfolioData();

            } else {
                console.log("使用者未登入。");
                currentUserId = null;

                document.getElementById('auth-container').style.display = 'block';
                document.querySelector('main').classList.add('hidden');
                document.getElementById('logout-btn').style.display = 'none';
                document.getElementById('user-info').classList.add('hidden');
                loadingOverlay.style.display = 'none';
            }
        });

        async function handleRegister() {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                showNotification('success', `註冊成功！歡迎 ${userCredential.user.email}`);
            } catch (error) {
                console.error("註冊失敗:", error);
                showNotification('error', `註冊失敗: ${error.message}`);
            }
        }

        async function handleLogin() {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                showNotification('success', `登入成功！歡迎回來 ${userCredential.user.email}`);
            } catch (error) {
                console.error("登入失敗:", error);
                showNotification('error', `登入失敗: ${error.message}`);
            }
        }

        async function handleLogout() {
            try {
                await signOut(auth);
                showNotification('info', '您已成功登出。');
            } catch (error) {
                console.error("登出失敗:", error);
                showNotification('error', `登出失敗: ${error.message}`);
            }
        }


        // --- 主應用程式邏輯 ---
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('loading-overlay').style.display = 'flex';
            
            initializeChart();
            initializeTwrChart();
            setupEventListeners();
            lucide.createIcons();
        });

        async function loadPortfolioData() {
            if (!currentUserId) {
                console.log("未登入，無法載入資料。");
                return;
            }
            document.getElementById('loading-overlay').style.display = 'flex';
            try {
                const response = await fetch(API.URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-KEY': API.KEY },
                    body: JSON.stringify({ action: 'get_data', uid: currentUserId })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || '伺服器發生錯誤');
                
                const portfolioData = result.data;
                transactions = portfolioData.transactions || [];
                userSplits = portfolioData.splits || [];
                marketDataForFrontend = portfolioData.marketData || {}; 
                
                const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
                    obj[item.symbol] = item; return obj;
                }, {});
                
                renderHoldingsTable(holdingsObject);
                renderTransactionsTable(); 
                renderSplitsTable();
                updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);
                updateAssetChart(portfolioData.history || {});
                const benchmarkSymbol = portfolioData.summary?.benchmarkSymbol || 'SPY';
                updateTwrChart(portfolioData.twrHistory || {}, portfolioData.benchmarkHistory || {}, benchmarkSymbol);
                document.getElementById('benchmark-symbol-input').value = benchmarkSymbol;
                showNotification('success', '資料同步完成！');
            } catch (error) {
                console.error('Failed to load portfolio data:', error);
                showNotification('error', `讀取資料失敗: ${error.message}`);
            } finally {
                document.getElementById('loading-overlay').style.display = 'none';
            }
        }

        // --- UI 渲染函式 (無變動) ---
        function renderHoldingsTable(currentHoldings) {
            const tableBody = document.getElementById('holdings-table-body');
            tableBody.innerHTML = '';
            const holdingsArray = Object.values(currentHoldings);
            if (holdingsArray.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-10 text-gray-500">沒有持股紀錄，請新增一筆交易。</td></tr>`;
                return;
            }
            holdingsArray.sort((a,b) => b.marketValueTWD - a.marketValueTWD).forEach(h => {
                const row = document.createElement('tr');
                row.className = "hover:bg-gray-50";
                const decimals = isTwStock(h.symbol) ? 0 : 2;
                row.innerHTML = `<td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900">${h.symbol}</td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.quantity, decimals)}</td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.avgCostOriginal, 2)} <span class="text-xs text-gray-500">${h.currency}</span></td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.totalCostTWD, 0)}</td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.currentPriceOriginal, 2)} <span class="text-xs text-gray-500">${h.currency}</span></td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(h.marketValueTWD, 0)}</td><td class="px-6 py-4 whitespace-nowrap font-semibold ${h.unrealizedPLTWD >= 0 ? 'text-red-600' : 'text-green-600'}">${formatNumber(h.unrealizedPLTWD, 0)}</td><td class="px-6 py-4 whitespace-nowrap font-semibold ${h.returnRate >= 0 ? 'text-red-600' : 'text-green-600'}">${(h.returnRate || 0).toFixed(2)}%</td>`;
                tableBody.appendChild(row);
            });
        }
        
        function renderTransactionsTable() {
            const tableBody = document.getElementById('transactions-table-body');
            tableBody.innerHTML = '';
            if (transactions.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-500">沒有交易紀錄。</td></tr>`;
                return;
            }
            for (const t of transactions) {
                const row = document.createElement('tr');
                row.className = "hover:bg-gray-50";
                const transactionDate = t.date.split('T')[0];
                const fxRate = t.exchangeRate || findFxRateForFrontend(t.currency, transactionDate);
                const totalAmountTWD = (t.totalCost || (t.quantity * t.price)) * fxRate;

                row.innerHTML = `<td class="px-6 py-4 whitespace-nowrap">${transactionDate}</td><td class="px-6 py-4 whitespace-nowrap font-medium">${t.symbol.toUpperCase()}</td><td class="px-6 py-4 whitespace-nowrap font-semibold ${t.type === 'buy' ? 'text-red-500' : 'text-green-500'}">${t.type === 'buy' ? '買入' : '賣出'}</td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(t.price)} <span class="text-xs text-gray-500">${t.currency}</span></td><td class="px-6 py-4 whitespace-nowrap">${formatNumber(totalAmountTWD, 0)}</td><td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium"><button data-id="${t.id}" class="edit-btn text-indigo-600 hover:text-indigo-900 mr-3">編輯</button><button data-id="${t.id}" class="delete-btn text-red-600 hover:text-red-900">刪除</button></td>`;
                tableBody.appendChild(row);
            };
        }

        const currencyToFx_FE = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
        function findFxRateForFrontend(currency, dateStr) {
            if (currency === 'TWD') return 1;
            const fxSym = currencyToFx_FE[currency];
            if (!fxSym || !marketDataForFrontend[fxSym]) return 1;
            const rates = marketDataForFrontend[fxSym].rates || {};
            if (rates[dateStr]) return rates[dateStr];
            let nearestDate = null;
            for (const rateDate in rates) {
                if (rateDate <= dateStr && (!nearestDate || rateDate > nearestDate)) {
                    nearestDate = rateDate;
                }
            }
            return nearestDate ? rates[nearestDate] : 1;
        }

        function renderSplitsTable() {
             const tableBody = document.getElementById('splits-table-body');
            tableBody.innerHTML = '';
            if (userSplits.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-10 text-gray-500">沒有自定義拆股事件。</td></tr>`;
                return;
            }
            for (const s of userSplits) {
                const row = document.createElement('tr');
                row.className = "hover:bg-gray-50";
                row.innerHTML = `<td class="px-6 py-4 whitespace-nowrap">${s.date.split('T')[0]}</td><td class="px-6 py-4 whitespace-nowrap font-medium">${s.symbol.toUpperCase()}</td><td class="px-6 py-4 whitespace-nowrap">${s.ratio}</td><td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium"><button data-id="${s.id}" class="delete-split-btn text-red-600 hover:text-red-900">刪除</button></td>`;
                tableBody.appendChild(row);
            }
        }
        function updateDashboard(currentHoldings, realizedPL, overallReturn, xirr) {
            const holdingsArray = Object.values(currentHoldings);
            const totalMarketValue = holdingsArray.reduce((sum, h) => sum + (h.marketValueTWD || 0), 0);
            const totalUnrealizedPL = holdingsArray.reduce((sum, h) => sum + (h.unrealizedPLTWD || 0), 0);
            document.getElementById('total-assets').textContent = formatNumber(totalMarketValue, 0);
            const unrealizedEl = document.getElementById('unrealized-pl');
            unrealizedEl.textContent = formatNumber(totalUnrealizedPL, 0);
            unrealizedEl.className = `text-3xl font-bold mt-2 ${totalUnrealizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
            const realizedEl = document.getElementById('realized-pl');
            realizedEl.textContent = formatNumber(realizedPL, 0);
            realizedEl.className = `text-3xl font-bold mt-2 ${realizedPL >= 0 ? 'text-red-600' : 'text-green-600'}`;
            const totalReturnEl = document.getElementById('total-return');
            totalReturnEl.textContent = `${(overallReturn || 0).toFixed(2)}%`;
            totalReturnEl.className = `text-3xl font-bold mt-2 ${overallReturn >= 0 ? 'text-red-600' : 'text-green-600'}`;
            const xirrEl = document.getElementById('xirr-value');
            xirrEl.textContent = `${((xirr || 0) * 100).toFixed(2)}%`;
            xirrEl.className = `text-3xl font-bold mt-2 ${xirr >= 0 ? 'text-red-600' : 'text-green-600'}`;
        }
        function updateAssetChart(portfolioHistory) {
            if (!portfolioHistory || Object.keys(portfolioHistory).length === 0) { if(chart) chart.updateSeries([{ data: [] }]); return; }
            const chartData = Object.entries(portfolioHistory).sort((a, b) => new Date(a[0]) - new Date(b[0])).map(([date, value]) => [new Date(date).getTime(), value]);
            if(chart) chart.updateSeries([{ data: chartData }]);
        }
        function updateTwrChart(twrHistory, benchmarkHistory, benchmarkSymbol) {
            const formatHistory = (history) => history ? Object.entries(history).sort((a, b) => new Date(a[0]) - new Date(b[0])).map(([date, value]) => [new Date(date).getTime(), value]) : [];
            if(twrChart) twrChart.updateSeries([ { name: '投資組合', data: formatHistory(twrHistory) }, { name: `Benchmark (${benchmarkSymbol || '...'})`, data: formatHistory(benchmarkHistory) } ]);
        }

        async function apiRequest(action, data) {
            if (!currentUserId && action !== 'migrate_user_data') { // 轉移功能允許在未登入時由管理者操作
                showNotification('error', '請先登入再執行操作。');
                throw new Error('User not logged in');
            }
            const payload = { action, uid: currentUserId, data };
            console.log("即將發送到後端的完整 Payload:", JSON.stringify(payload, null, 2));
            const response = await fetch(API.URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': API.KEY
                },
                body: JSON.stringify(payload)
            });
        
            const result = await response.json();
            if (!response.ok) {
                console.error("後端返回的錯誤詳情:", result); 
                throw new Error(result.message || '伺服器發生錯誤');
            }
            return result;
        }
        
        // --- [新增] 資料轉移處理函式 ---
        async function handleMigrateData() {
            const sourceUid = document.getElementById('source-uid').value.trim();
            const targetUid = document.getElementById('target-uid').value.trim();

            if (!sourceUid || !targetUid) {
                showNotification('error', '請同時輸入來源和目標 UID。');
                return;
            }

            const message = `您確定要將使用者 ${sourceUid} 的所有資料轉移給 ${targetUid} 嗎？\n\n這個操作無法復原！`;
            
            showConfirm(message, async () => {
                try {
                    showNotification('info', '正在開始轉移資料...');
                    // 注意：此處的 uid 參數在後端不會被使用，但為了共用 apiRequest 函式而傳入
                    await apiRequest('migrate_user_data', { sourceUid, targetUid });
                    showNotification('success', '資料轉移成功！請使用新帳號重新登入以查看資料。');
                } catch (error) {
                    console.error('資料轉移失敗:', error);
                    showNotification('error', `資料轉移失敗: ${error.message}`);
                }
            });
        }

        function handleEdit(e) {
            const txId = e.target.dataset.id;
            const transaction = transactions.find(t => t.id === txId);
            if (!transaction) return;
            openModal('transaction-modal', true, transaction);
        }
        async function handleDelete(e) {
            const txId = e.target.dataset.id;
            showConfirm('確定要刪除這筆交易紀錄嗎？', async () => {
                try {
                    await apiRequest('delete_transaction', { txId });
                    showNotification('success', '交易紀錄已刪除！');
                    await loadPortfolioData();
                } catch (error) {
                    showNotification('error', `刪除失敗: ${error.message}`);
                }
            });
        }
        async function handleDeleteSplit(e) {
            const splitId = e.target.dataset.id;
            showConfirm('確定要刪除這個拆股事件嗎？', async () => {
                try {
                    await apiRequest('delete_split', { splitId });
                    showNotification('success', '拆股事件已刪除！');
                    await loadPortfolioData();
                } catch (error) {
                    showNotification('error', `刪除失敗: ${error.message}`);
                }
            });
        }
        async function handleFormSubmit(e) {
            e.preventDefault();
            const saveBtn = document.getElementById('save-btn');
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 儲存中...`;
        
            const txId = document.getElementById('transaction-id').value;
            const isEditing = !!txId;
        
            const transactionData = {
                date: document.getElementById('transaction-date').value,
                symbol: document.getElementById('stock-symbol').value.toUpperCase().trim(),
                type: document.querySelector('input[name="transaction-type"]:checked').value,
                quantity: parseFloat(document.getElementById('quantity').value),
                price: parseFloat(document.getElementById('price').value),
                currency: document.getElementById('currency').value,
                totalCost: parseFloat(document.getElementById('total-cost').value) || null,
                exchangeRate: parseFloat(document.getElementById('exchange-rate').value) || null
            };
        
            if (!transactionData.symbol || isNaN(transactionData.quantity) || isNaN(transactionData.price)) {
                showNotification('error', '請填寫所有必填欄位。');
                saveBtn.disabled = false;
                saveBtn.textContent = '儲存';
                return;
            }
        
            try {
                const action = isEditing ? 'edit_transaction' : 'add_transaction';
                const payload = isEditing ? { txId, txData: transactionData } : transactionData;
        
                await apiRequest(action, payload);
        
                closeModal('transaction-modal');
                await loadPortfolioData();
                showNotification('success', isEditing ? '交易已更新！' : '交易已新增！');
        
            } catch (error) {
                console.error('Failed to save transaction:', error);
                showNotification('error', `儲存交易失敗: ${error.message}`);
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '儲存';
            }
        }
        async function handleSplitFormSubmit(e) {
            e.preventDefault();
            const saveBtn = document.getElementById('save-split-btn');
            saveBtn.disabled = true;
            const splitData = { date: document.getElementById('split-date').value, symbol: document.getElementById('split-symbol').value.toUpperCase().trim(), ratio: parseFloat(document.getElementById('split-ratio').value) };
            if (!splitData.symbol || isNaN(splitData.ratio) || splitData.ratio <= 0) {
                showNotification('error', '請填寫所有欄位並確保比例大於0。');
                saveBtn.disabled = false; return;
            }
            try {
                await apiRequest('add_split', splitData);
                closeModal('split-modal');
                await loadPortfolioData();
            } catch (error) {
                console.error('Failed to add split event:', error);
                showNotification('error', `新增拆股事件失敗: ${error.message}`);
            } finally {
                saveBtn.disabled = false;
            }
        }
        async function handleUpdateBenchmark() {
            const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
            if (!newBenchmark) { showNotification('error', '請輸入 Benchmark 的股票代碼。'); return; }
            try {
                showNotification('info', `正在更新 Benchmark 並重算...`);
                await apiRequest('update_benchmark', { benchmarkSymbol: newBenchmark });
                await loadPortfolioData();
            } catch(error) {
                showNotification('error', `更新 Benchmark 失敗: ${error.message}`);
            }
        }
        function setupEventListeners() {
            document.getElementById('login-btn').addEventListener('click', handleLogin);
            document.getElementById('register-btn').addEventListener('click', handleRegister);
            document.getElementById('logout-btn').addEventListener('click', handleLogout);
            document.getElementById('migrate-btn').addEventListener('click', handleMigrateData); // [新增]

            document.getElementById('add-transaction-btn').addEventListener('click', () => openModal('transaction-modal'));
            document.getElementById('transaction-form').addEventListener('submit', handleFormSubmit);
            document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));
            document.getElementById('tabs').addEventListener('click', (e) => { e.preventDefault(); if (e.target.matches('.tab-item')) { switchTab(e.target.dataset.tab); } });
            document.getElementById('transactions-table-body').addEventListener('click', (e) => { 
                if (e.target.classList.contains('edit-btn')) { handleEdit(e); } 
                if (e.target.classList.contains('delete-btn')) { handleDelete(e); } 
            });
            document.getElementById('splits-table-body').addEventListener('click', (e) => { if (e.target.classList.contains('delete-split-btn')) { handleDeleteSplit(e); } });
            document.getElementById('manage-splits-btn').addEventListener('click', () => openModal('split-modal'));
            document.getElementById('split-form').addEventListener('submit', handleSplitFormSubmit);
            document.getElementById('cancel-split-btn').addEventListener('click', () => closeModal('split-modal'));
            document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirm);
            document.getElementById('confirm-ok-btn').addEventListener('click', () => { if (confirmCallback) { confirmCallback(); } hideConfirm(); });
            document.getElementById('currency').addEventListener('change', toggleOptionalFields);
            document.getElementById('update-benchmark-btn').addEventListener('click', handleUpdateBenchmark);
        }
        function initializeChart() {
            const options = { chart: { type: 'area', height: 350, zoom: { enabled: true }, toolbar: { show: true } }, series: [{ name: '總資產', data: [] }], xaxis: { type: 'datetime', labels: { datetimeUTC: false, format: 'yy/MM/dd' } }, yaxis: { labels: { formatter: (value) => { return formatNumber(value, 0) } } }, dataLabels: { enabled: false }, stroke: { curve: 'smooth', width: 2 }, fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.3, stops: [0, 90, 100] } }, tooltip: { x: { format: 'yyyy/MM/dd' }, y: { formatter: (value) => { return formatNumber(value,0) } } }, colors: ['#4f46e5'] };
            chart = new ApexCharts(document.querySelector("#asset-chart"), options);
            chart.render();
        }
        function initializeTwrChart() {
            const options = { chart: { type: 'line', height: 350, zoom: { enabled: true }, toolbar: { show: true } }, series: [{ name: '投資組合', data: [] }, { name: 'Benchmark', data: [] }], xaxis: { type: 'datetime', labels: { datetimeUTC: false, format: 'yy/MM/dd' } }, yaxis: { labels: { formatter: (value) => `${(value || 0).toFixed(2)}%` } }, dataLabels: { enabled: false }, stroke: { curve: 'smooth', width: 2 }, tooltip: { y: { formatter: (value) => `${(value || 0).toFixed(2)}%` } }, colors: ['#4f46e5', '#f59e0b'] };
            twrChart = new ApexCharts(document.querySelector("#twr-chart"), options);
            twrChart.render();
        }
        function openModal(modalId, isEdit = false, data = null) { 
            const formId = modalId.replace('-modal', '-form');
            const form = document.getElementById(formId);
            if (form) form.reset();
            if (modalId === 'transaction-modal') {
                document.getElementById('transaction-id').value = '';
                if(isEdit && data) {
                    document.getElementById('modal-title').textContent = '編輯交易紀錄'; 
                    document.getElementById('transaction-id').value = data.id; 
                    document.getElementById('transaction-date').value = data.date.split('T')[0];
                    document.getElementById('stock-symbol').value = data.symbol; 
                    document.querySelector(`input[name="transaction-type"][value="${data.type}"]`).checked = true; 
                    document.getElementById('quantity').value = data.quantity; 
                    document.getElementById('price').value = data.price; 
                    document.getElementById('currency').value = data.currency;
                    document.getElementById('exchange-rate').value = data.exchangeRate || '';
                    document.getElementById('total-cost').value = data.totalCost || '';
                } else {
                    document.getElementById('modal-title').textContent = '新增交易紀錄'; 
                    document.getElementById('transaction-date').value = new Date().toISOString().split('T')[0];
                }
                toggleOptionalFields();
            } else if (modalId === 'split-modal') {
                 document.getElementById('split-date').value = new Date().toISOString().split('T')[0];
            }
            document.getElementById(modalId).classList.remove('hidden');
        }
        function closeModal(modalId) { 
            document.getElementById(modalId).classList.add('hidden');
        }
        function showConfirm(message, callback) { 
            document.getElementById('confirm-message').textContent = message; 
            confirmCallback = callback; 
            document.getElementById('confirm-modal').classList.remove('hidden'); 
        }
        function hideConfirm() { 
            confirmCallback = null; 
            document.getElementById('confirm-modal').classList.add('hidden'); 
        }
        function toggleOptionalFields() {
            const currency = document.getElementById('currency').value;
            const exchangeRateField = document.getElementById('exchange-rate-field');
            if (currency === 'TWD') {
                exchangeRateField.style.display = 'none';
            } else {
                exchangeRateField.style.display = 'block';
            }
        }
        function isTwStock(symbol) { 
            return symbol ? symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO') : false; 
        }
        function formatNumber(value, decimals = 2) { 
            const num = Number(value); 
            if (isNaN(num)) return decimals === 0 ? '0' : '0.00'; 
            return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); 
        }
        function showNotification(type, message) { 
            const area = document.getElementById('notification-area'); 
            const color = type === 'success' ? 'bg-green-500' : (type === 'info' ? 'bg-blue-500' : 'bg-red-500'); 
            const icon = type === 'success' ? 'check-circle' : (type === 'info' ? 'info' : 'alert-circle'); 
            const notification = document.createElement('div'); 
            notification.className = `flex items-center ${color} text-white text-sm font-bold px-4 py-3 rounded-md shadow-lg mb-2`; 
            notification.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5 mr-2"></i><p>${message}</p>`; 
            area.appendChild(notification); 
            lucide.createIcons({nodes: [notification.querySelector('i')]});
            setTimeout(() => { 
                notification.style.transition = 'opacity 0.5s ease'; 
                notification.style.opacity = '0'; 
                setTimeout(() => notification.remove(), 500); 
            }, 5000); 
        }
        function switchTab(tabName) { 
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden')); 
            document.getElementById(`${tabName}-tab`).classList.remove('hidden'); 
            document.querySelectorAll('.tab-item').forEach(el => { 
                el.classList.remove('border-indigo-500', 'text-indigo-600'); 
                el.classList.add('border-transparent', 'text-gray-500'); 
            }); 
            const activeTab = document.querySelector(`[data-tab="${tabName}"]`); 
            activeTab.classList.add('border-indigo-500', 'text-indigo-600'); 
            activeTab.classList.remove('border-transparent', 'text-gray-500'); 
        }
    </script>
</body>
</html>
", in the document, and I want to know:
我該如
