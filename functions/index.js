/* eslint-disable */
// =========================================================================================
// == GCP Cloud Function 完整程式码 (v1.5.4 - 真正完整、无省略、修正所有已知错误)
// =========================================================================================

const functions = require("firebase-functions");
const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');

// --- 平台设定 ---
const D1_WORKER_URL = process.env.D1_WORKER_URL;
const D1_API_KEY = process.env.D1_API_KEY;

// --- D1 资料库客户端 ---
const d1Client = {
  async query(sql, params = []) {
    if (!D1_WORKER_URL || !D1_API_KEY) { throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set."); }
    try {
      const response = await axios.post(`${D1_WORKER_URL}/query`, { sql, params }, { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } });
      if (response.data && response.data.success) { return response.data.results; }
      throw new Error(response.data.error || "D1 query failed");
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
      throw new Error(response.data.error || "D1 batch operation failed");
    } catch (error) {
      console.error("d1Client.batch Error:", error.response ? error.response.data : error.message);
      throw new Error(`Failed to execute D1 batch: ${error.message}`);
    }
  }
};

// --- 资料准备与抓取函式 ---
async function fetchAndSaveMarketData(symbol) {
  try {
    console.log(`Fetching full history for ${symbol} from Yahoo Finance...`);
    const hist = await yahooFinance.historical(symbol, { 
        period1: '2000-01-01', 
        interval: '1d',
        autoAdjust: false,
        backAdjust: false
    });
    const dbOps = [];
    const tableName = symbol.includes("=") ? "exchange_rates" : "price_history";
    dbOps.push({ sql: `DELETE FROM ${tableName} WHERE symbol = ?`, params: [symbol] });
    if (!symbol.includes("=")) {
        dbOps.push({ sql: `DELETE FROM dividend_history WHERE symbol = ?`, params: [symbol] });
    }
    for(const item of hist) {
        if(item.close) {
            dbOps.push({
                sql: `INSERT INTO ${tableName} (symbol, date, price) VALUES (?, ?, ?)`,
                params: [symbol, item.date.toISOString().split("T")[0], item.close]
            });
        }
        if(item.dividends && item.dividends > 0) {
             dbOps.push({
                sql: `INSERT INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)`,
                params: [symbol, item.date.toISOString().split("T")[0], item.dividends]
            });
        }
    }
    await d1Client.batch(dbOps);
    console.log(`Successfully fetched and wrote full history for ${symbol}.`);
    const prices = hist.reduce((acc, cur) => { if (cur.close) acc[cur.date.toISOString().split("T")[0]] = cur.close; return acc; }, {});
    const dividends = hist.reduce((acc, cur) => { if (cur.dividends > 0) acc[cur.date.toISOString().split("T")[0]] = cur.dividends; return acc; }, {});
    return { prices, dividends, rates: prices };
  } catch (e) {
    console.log(`ERROR: fetchAndSaveMarketData for ${symbol} failed. Reason: ${e.message}`);
    return null;
  }
}

async function getMarketDataFromDb(txs, benchmarkSymbol) {
  const syms = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
  const currencies = [...new Set(txs.map(t => t.currency || "USD"))].filter(c => c !== "TWD");
  const fxSyms = currencies.map(c => currencyToFx[c]).filter(Boolean);
  const allRequiredSymbols = [...new Set([...syms, ...fxSyms, benchmarkSymbol.toUpperCase()])];
  console.log(`Data check for symbols: ${allRequiredSymbols.join(', ')}`);
  const marketData = {};
  for (const s of allRequiredSymbols) {
    if (!s) continue;
    const isFx = s.includes("=");
    const priceTable = isFx ? "exchange_rates" : "price_history";
    const divTable = "dividend_history";
    const priceData = await d1Client.query(`SELECT date, price FROM ${priceTable} WHERE symbol = ?`, [s]);
    if (priceData.length > 0) {
      marketData[s] = {
          prices: priceData.reduce((acc, row) => { acc[row.date] = row.price; return acc; }, {}),
          dividends: {}
      };
      if (isFx) marketData[s].rates = marketData[s].prices;
      if(!isFx) {
          const divData = await d1Client.query(`SELECT date, dividend FROM ${divTable} WHERE symbol = ?`, [s]);
          marketData[s].dividends = divData.reduce((acc, row) => { acc[row.date] = row.dividend; return acc; }, {});
      }
    } else {
      console.log(`Data for ${s} not found in D1. Fetching now...`);
      const fetchedData = await fetchAndSaveMarketData(s);
      if (fetchedData) {
        marketData[s] = fetchedData;
      } else {
        throw new Error(`Failed to fetch critical market data for ${s}. Aborting calculation.`);
      }
    }
  }
  console.log("All required market data is present and loaded.");
  return marketData;
}

// --- 核心计算与辅助函式 (完整版) ---
const toDate = v => v.toDate ? v.toDate() : new Date(v);
const currencyToFx = { USD: "TWD=X", HKD: "HKD=TWD", JPY: "JPY=TWD" };

function isTwStock(symbol) {
    if (!symbol) return false;
    const upperSymbol = symbol.toUpperCase();
    return upperSymbol.endsWith('.TW') || upperSymbol.endsWith('.TWO');
}

function getTotalCost(tx) {
  return (tx.totalCost !== undefined && tx.totalCost !== null)
    ? Number(tx.totalCost)
    : Number(tx.price || 0) * Number(tx.quantity || 0);
}

function findNearest(hist, date, toleranceDays = 7) {
    if (!hist || Object.keys(hist).length === 0) return undefined;
    const tgt = date instanceof Date ? date : new Date(date);
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
  if (!fxSym) return 1;
  const hist = market[fxSym]?.rates || {};
  return findNearest(hist, date, tolerance) ?? 1;
}

function getPortfolioStateOnDate(allEvts, targetDate) {
    const state = {};
    const pastEvents = allEvts.filter(e => toDate(e.date) <= toDate(targetDate));
    for (const e of pastEvents) {
        const sym = e.symbol.toUpperCase();
        if (!state[sym]) state[sym] = { lots: [], currency: e.currency || "USD" };
        if (e.eventType === 'transaction') {
            state[sym].currency = e.currency;
            const costPerShareOriginal = getTotalCost(e) / (e.quantity || 1);
            if (e.type === 'buy') {
                state[sym].lots.push({ quantity: e.quantity, pricePerShareOriginal: costPerShareOriginal, date: toDate(e.date) });
            } else {
                let sellQty = e.quantity;
                state[sym].lots.sort((a,b) => a.date - b.date); // FIFO
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
                lot.pricePerShareOriginal /= e.ratio;
            });
        }
    }
    return state;
}

function dailyValue(state, market, date) {
    return Object.keys(state).reduce((totalValue, sym) => {
        const s = state[sym];
        const qty = s.lots.reduce((sum, lot) => sum + lot.quantity, 0);
        if (qty < 1e-9) return totalValue;
        const price = findNearest(market[sym]?.prices, date);
        if (price === undefined) {
             const yesterday = new Date(date);
             yesterday.setDate(yesterday.getDate() - 1);
             return totalValue + dailyValue({[sym]: s}, market, yesterday);
        }
        const fx = findFxRate(market, s.currency, date);
        return totalValue + (qty * price * fx);
    }, 0);
}

function prepareEvents(txs, splits, market) {
    const firstBuyDateMap = {};
    txs.forEach(tx => {
        if (tx.type === "buy") {
            const sym = tx.symbol.toUpperCase();
            const d = toDate(tx.date);
            if (!firstBuyDateMap[sym] || d < firstBuyDateMap[sym]) firstBuyDateMap[sym] = d;
        }
    });
    const evts = [
        ...txs.map(t => ({ ...t, date: toDate(t.date), eventType: "transaction" })),
        ...splits.map(s => ({ ...s, date: toDate(s.date), eventType: "split" }))
    ];
    Object.keys(market).forEach(sym => {
        if (market[sym] && market[sym].dividends) {
            Object.entries(market[sym].dividends).forEach(([dateStr, amount]) => {
                const dividendDate = new Date(dateStr);
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
    let lastValue = 0;
    while (curDate <= today) {
        const dateStr = curDate.toISOString().split("T")[0];
        const stateOnDate = getPortfolioStateOnDate(evts, curDate);
        const value = dailyValue(stateOnDate, market, curDate);
        lastValue = value > 0 ? value : lastValue;
        history[dateStr] = lastValue;
        curDate.setDate(curDate.getDate() + 1);
    }
    return history;
}

function calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, startDate) {
    const dates = Object.keys(dailyPortfolioValues).sort();
    if (!startDate || dates.length === 0) return { twrHistory: {}, benchmarkHistory: {} };
    const upperBenchmarkSymbol = benchmarkSymbol.toUpperCase();
    const benchmarkPrices = market[upperBenchmarkSymbol]?.prices || {};
    const benchmarkCurrency = (upperBenchmarkSymbol.endsWith('.TW') || upperBenchmarkSymbol.endsWith('.TWO')) ? 'TWD' : 'USD';
    const benchmarkStartPrice = findNearest(benchmarkPrices, startDate);
    if (!benchmarkStartPrice) {
        console.log(`TWR_CALC_FAIL: Cannot find start price for benchmark ${upperBenchmarkSymbol}.`);
        return { twrHistory: {}, benchmarkHistory: {} };
    }
    const startFx = findFxRate(market, benchmarkCurrency, startDate);
    const benchmarkStartPriceTWD = benchmarkStartPrice * startFx;
    const cashflows = evts.reduce((acc, e) => {
        const dateStr = toDate(e.date).toISOString().split('T')[0];
        let flow = 0;
        const currency = e.currency || market[e.symbol.toUpperCase()]?.currency || 'USD';
        const fx = findFxRate(market, currency, toDate(e.date));
        if (e.eventType === 'transaction') {
            flow = (e.type === 'buy' ? 1 : -1) * getTotalCost(e) * (currency === 'TWD' ? 1 : fx);
        } else if (e.eventType === 'dividend') {
            const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.date));
            const shares = stateOnDate[e.symbol.toUpperCase()]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0;
            if (shares > 0) {
                const taxRate = isTwStock(e.symbol) ? 0.0 : 0.30;
                flow = -1 * e.amount * (1 - taxRate) * shares * fx;
            }
        }
        if (flow !== 0) acc[dateStr] = (acc[dateStr] || 0) + flow;
        return acc;
    }, {});
    const twrHistory = {}, benchmarkHistory = {};
    let cumulativeHpr = 1, lastMarketValue = 0;
    for (const dateStr of dates) {
        const MVE = dailyPortfolioValues[dateStr];
        const CF = cashflows[dateStr] || 0;
        const denominator = lastMarketValue + CF;
        if (denominator !== 0 && MVE !== 0) cumulativeHpr *= (MVE / denominator);
        twrHistory[dateStr] = (cumulativeHpr - 1) * 100;
        lastMarketValue = MVE;
        const currentBenchPrice = findNearest(benchmarkPrices, new Date(dateStr));
        if (currentBenchPrice && benchmarkStartPriceTWD > 0) {
            const currentFx = findFxRate(market, benchmarkCurrency, new Date(dateStr));
            const currentBenchPriceTWD = currentBenchPrice * currentFx;
            benchmarkHistory[dateStr] = ((currentBenchPriceTWD / benchmarkStartPriceTWD) - 1) * 100;
        }
    }
    return { twrHistory, benchmarkHistory };
}

function calculateFinalHoldings(pf, market) {
  const holdingsToUpdate = {};
  const today = new Date();
  for (const sym in pf) {
    const h = pf[sym];
    const qty = h.lots.reduce((s, l) => s + l.quantity, 0);
    if (qty > 1e-9) {
        const totCostOrg = h.lots.reduce((s, l) => s + l.quantity * l.pricePerShareOriginal, 0);
        const totCostTWD = h.lots.reduce((s, l) => {
            const lotFx = findFxRate(market, h.currency, l.date);
            return s + l.quantity * l.pricePerShareOriginal * lotFx;
        }, 0);
        const priceHist = market[sym]?.prices || {};
        const curPrice = findNearest(priceHist, today);
        const fx = findFxRate(market, h.currency, today);
        const mktVal = qty * (curPrice ?? 0) * fx;
        const unreal = mktVal - totCostTWD;
        const invested = totCostTWD + h.realizedCostTWD;
        const rrCurrent = totCostTWD > 0 ? (unreal / totCostTWD) * 100 : 0;
        
        holdingsToUpdate[sym] = {
          symbol: sym, quantity: qty, currency: h.currency,
          avgCostOriginal: totCostOrg > 0 ? totCostOrg / qty : 0, 
          totalCostTWD: totCostTWD, 
          investedCostTWD: invested,
          currentPriceOriginal: curPrice ?? null, 
          marketValueTWD: mktVal,
          unrealizedPLTWD: unreal, 
          realizedPLTWD: h.realizedPLTWD,
          returnRate: rrCurrent
        };
    }
  }
  return { holdingsToUpdate, holdingsToDelete: [] };
}

function createCashflowsForXirr(evts, holdings, market) {
    const flows = [];
    evts.filter(e => e.eventType === "transaction").forEach(t => {
        const fx = findFxRate(market, t.currency, toDate(t.date));
        const amt = getTotalCost(t) * fx;
        flows.push({ date: toDate(t.date), amount: t.type === "buy" ? -amt : amt });
    });
    evts.filter(e => e.eventType === "dividend").forEach(d => {
        const stateOnDate = getPortfolioStateOnDate(evts, toDate(d.date));
        const sym = d.symbol.toUpperCase();
        const currency = stateOnDate[sym]?.currency || 'USD';
        const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
        if (shares > 0) {
            const fx = findFxRate(market, currency, toDate(d.date));
            const taxRate = isTwStock(sym) ? 0.0 : 0.30;
            const amt = d.amount * (1 - taxRate) * shares * fx;
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
        .filter(([,amount]) => Math.abs(amount) > 1e-6)
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

function calculateCoreMetrics(evts, market) {
    const pf = {};
    let totalRealizedPL = 0;
    for (const e of evts) {
        const sym = e.symbol.toUpperCase();
        if (!pf[sym]) pf[sym] = { lots: [], currency: e.currency || "USD", realizedPLTWD: 0, realizedCostTWD: 0 };
        switch (e.eventType) {
            case "transaction": {
                if (e.type === "buy") {
                    pf[sym].lots.push({ quantity: e.quantity, pricePerShareOriginal: e.price, date: toDate(e.date) });
                } else {
                    const fx = findFxRate(market, e.currency, toDate(e.date));
                    const saleProceedsTWD = getTotalCost(e) * fx;
                    let sellQty = e.quantity;
                    let costOfGoodsSoldTWD = 0;
                    pf[sym].lots.sort((a,b) => a.date - b.date); // FIFO
                    while (sellQty > 0 && pf[sym].lots.length > 0) {
                        const lot = pf[sym].lots[0];
                        const lotFx = findFxRate(market, pf[sym].currency, lot.date);
                        const lotCostTWD = lot.quantity * lot.pricePerShareOriginal * lotFx;
                        const qtyToSell = Math.min(sellQty, lot.quantity);
                        costOfGoodsSoldTWD += qtyToSell * (lotCostTWD / lot.quantity);
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
                    l.pricePerShareOriginal /= e.ratio;
                });
                break;
            case "dividend": {
                const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.date));
                const shares = stateOnDate[sym]?.lots.reduce((s, l) => s + l.quantity, 0) || 0;
                if (shares > 0) {
                    const fx = findFxRate(market, pf[sym].currency, toDate(e.date));
                    const taxRate = isTwStock(sym) ? 0.0 : 0.30;
                    const divTWD = e.amount * (1 - taxRate) * shares * fx;
                    totalRealizedPL += divTWD;
                    pf[sym].realizedPLTWD += divTWD;
                }
                break;
            }
        }
    }
    const { holdingsToUpdate } = calculateFinalHoldings(pf, market);
    const xirrFlows = createCashflowsForXirr(evts, holdingsToUpdate, market);
    const xirr = calculateXIRR(xirrFlows);
    const totalUnrealizedPL = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.unrealizedPLTWD, 0);
    const totalInvestedCost = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.investedCostTWD, 0);
    const totalReturnValue = totalRealizedPL + totalUnrealizedPL;
    const overallReturnRate = totalInvestedCost > 0 ? (totalReturnValue / totalInvestedCost) * 100 : 0;
    return { holdings: { holdingsToUpdate, holdingsToDelete: [] }, totalRealizedPL, xirr, overallReturnRate };
}

async function performRecalculation(uid) {
    console.log(`--- [${uid}] Recalculation Process Start (v1.5.4) ---`);
    try {
        const controlsData = await d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']);
        const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';
        const [txs, splits] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid])
        ]);
        if (txs.length === 0) { 
            await d1Client.batch([
                { sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
            ]);
            return; 
        }
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
                sql: `INSERT INTO holdings (uid, symbol, quantity, currency, avgCostOriginal, totalCostTWD, investedCostTWD, currentPriceOriginal, marketValueTWD, unrealizedPLTWD, realizedPLTWD, returnRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [ uid, h.symbol, h.quantity, h.currency, h.avgCostOriginal, h.totalCostTWD, h.investedCostTWD, h.currentPriceOriginal, h.marketValueTWD, h.unrealizedPLTWD, h.realizedPLTWD, h.returnRate ]
            });
        }
        
        const summaryData = {
            totalRealizedPL: portfolioResult.totalRealizedPL,
            xirr: portfolioResult.xirr,
            overallReturnRate: portfolioResult.overallReturnRate,
            benchmarkSymbol: benchmarkSymbol,
        };
        const finalBatch = [
            { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid]},
            { 
                sql: `INSERT INTO portfolio_summary (uid, summary_data, history, twrHistory, benchmarkHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?)`,
                params: [ uid, JSON.stringify(summaryData), JSON.stringify(dailyPortfolioValues), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), new Date().toISOString() ]
            },
            ...dbOps
        ];
        await d1Client.batch(finalBatch);
        console.log(`--- [${uid}] Recalculation Process Done ---`);
    } catch (e) {
        console.error(`[${uid}] CRITICAL ERROR during calculation:`, e);
        throw e;
    }
}

exports.unifiedPortfolioHandler = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY'); res.set('Access-Control-Max-Age', '3600'); res.status(204).send(''); return; }
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== D1_API_KEY) return res.status(401).send('Unauthorized');

    const { action, uid, data } = req.body;
    if (!action || !uid) return res.status(400).send({ success: false, message: 'Bad Request: Missing action or uid.' });

    try {
        switch (action) {
            case 'recalculate':
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: `Recalculation successful for ${uid}` });
            
            case 'get_data': {
                const [txs, splits] = await Promise.all([
                    d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
                    d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid])
                ]);
                const benchmarkData = await d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']);
                const benchmarkSymbol = benchmarkData.length > 0 ? benchmarkData[0].value : 'SPY';
                const marketData = await getMarketDataFromDb(txs, benchmarkSymbol);
                const [summaryResult, holdingsResult] = await Promise.all([
                    d1Client.query('SELECT summary_data, history, twrHistory, benchmarkHistory FROM portfolio_summary WHERE uid = ?', [uid]),
                    d1Client.query('SELECT * FROM holdings WHERE uid = ? ORDER BY marketValueTWD DESC', [uid])
                ]);
                const summary = summaryResult.length > 0 ? JSON.parse(summaryResult[0].summary_data || '{}') : {};
                const history = summaryResult.length > 0 ? JSON.parse(summaryResult[0].history || '{}') : {};
                const twrHistory = summaryResult.length > 0 ? JSON.parse(summaryResult[0].twrHistory || '{}') : {};
                const benchmarkHistory = summaryResult.length > 0 ? JSON.parse(summaryResult[0].benchmarkHistory || '{}') : {};
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
            case 'add_transaction': {
                const { txData } = data;
                if (!txData || !txData.symbol) return res.status(400).send({ success: false, message: 'Bad Request: Missing transaction data.' });
                const newTxId = uuidv4();
                await d1Client.query( `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [newTxId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate] );
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: 'Transaction added and recalculation triggered.', txId: newTxId });
            }
            case 'edit_transaction': {
                const { txId, txData } = data;
                if (!txId || !txData) return res.status(400).send({ success: false, message: 'Bad Request: Missing txId or txData.' });
                await d1Client.query( `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`, [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid] );
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: 'Transaction updated and recalculation triggered.' });
            }
            case 'delete_transaction': {
                const { txId } = data;
                if (!txId) return res.status(400).send({ success: false, message: 'Bad Request: Missing txId.' });
                await d1Client.query('DELETE FROM transactions WHERE id = ? AND uid = ?', [txId, uid]);
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: 'Transaction deleted and recalculation triggered.' });
            }
            case 'add_split': {
                const splitData = data;
                if (!splitData || !splitData.symbol || !splitData.ratio) return res.status(400).send({ success: false, message: 'Bad Request: Missing split data.' });
                const newSplitId = uuidv4();
                await d1Client.query( `INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?, ?, ?, ?, ?)`, [newSplitId, uid, splitData.date, splitData.symbol, splitData.ratio] );
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: 'Split event added and recalculation triggered.', splitId: newSplitId });
            }
            case 'delete_split': {
                const { splitId } = data;
                if (!splitId) return res.status(400).send({ success: false, message: 'Bad Request: Missing splitId.' });
                await d1Client.query('DELETE FROM splits WHERE id = ? AND uid = ?', [splitId, uid]);
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: 'Split event deleted and recalculation triggered.' });
            }
            case 'update_benchmark': {
                const { benchmarkSymbol } = data;
                if (!benchmarkSymbol) return res.status(400).send({ success: false, message: 'Bad Request: Missing benchmarkSymbol.' });
                await getMarketDataFromDb([], benchmarkSymbol); 
                await d1Client.query( 'INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)', [uid, 'benchmarkSymbol', benchmarkSymbol] );
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: 'Benchmark updated and recalculation triggered.' });
            }
            default:
                return res.status(400).send({ success: false, message: 'Unknown action' });
        }
    } catch (error) {
        console.error(`[${uid}] Handler failed for action '${action}':`, error);
        return res.status(500).send({ success: false, message: `An internal error occurred: ${error.message}` });
    }
});
