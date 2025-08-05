/* eslint-disable */
// =========================================================================================
// == GCP Cloud Function 完整程式碼 (v2.4.0 - 最終修正版)
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

    // 案例 1: 全新商品，資料庫完全沒有紀錄
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
        return; // 完成新商品處理
    }

    const currentEarliestDate = coverageData[0].earliest_date;
    // 案例 2: 已有紀錄，但新交易日期更早
    if (requiredStartDate < currentEarliestDate) {
        // [v2.4.0 核心修正] 模仿週末腳本的可靠行為：先刪除，再完整重抓
        console.log(`[Coverage Check] 新日期 ${requiredStartDate} 早於現有紀錄 ${currentEarliestDate}。將對 ${symbol} 執行完整數據覆蓋。`);
        
        const isFx = symbol.includes("=");
        const priceTable = isFx ? "exchange_rates" : "price_history";
        const deleteOps = [{ sql: `DELETE FROM ${priceTable} WHERE symbol = ?`, params: [symbol] }];
        if (!isFx) {
            deleteOps.push({ sql: `DELETE FROM dividend_history WHERE symbol = ?`, params: [symbol] });
        }
        await d1Client.batch(deleteOps);
        console.log(`[Coverage Check] 已刪除 ${symbol} 的所有舊市場數據。`);

        // 重新完整抓取
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

// --- 完整計算函式保留區 (開始) ---
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
// --- 完整計算函式保留區 (結束) ---

async function performRecalculation(uid) {
    console.log(`--- [${uid}] 重新計算程序開始 (v2.3.1) ---`);
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

            default:
                return res.status(400).send({ success: false, message: '未知的操作' });
        }
    } catch (error) {
        const errorMessage = error.message || 'An unknown error occurred.';
        console.error(`[${uid || 'N/A'}] '${action}' 操作的處理程序失敗：`, errorMessage);
        return res.status(500).send({ success: false, message: `發生內部錯誤：${errorMessage}` });
    }
});
" in the document.
The user wants to add a new action to clear the entire database.

I will add two new actions:
1.  `clear_user_data`: Clears all data for a specific user.
2.  `__DANGEROUSLY_CLEAR_ENTIRE_DATABASE__`: Clears all data from all tables, for all users. This is the one the user explicitly asked for.

I will add these actions to the `switch` statement in `exports.unifiedPortfolioHandler`.
I will also update the version number in the header comme
