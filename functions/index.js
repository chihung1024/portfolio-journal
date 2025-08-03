/* eslint-disable */
// =========================================================================================
// == GCP Cloud Function 完整程式碼 (極簡啟動版)
// == 最後更新時間：2025-08-03
// == 功能：
// == 1. 接收來自 Cloudflare Worker 的 HTTP 請求。
// == 2. 包含所有投資組合計算邏輯。
// == 3. 透過 API 呼叫 Cloudflare Worker 來讀寫 D1 資料庫。
// =========================================================================================

const functions = require("firebase-functions");
const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");

// --- 平台設定 ---
// 這些值將會透過 GCP 的環境變數功能設定，無需在此修改
const D1_WORKER_URL = process.env.D1_WORKER_URL;
const D1_API_KEY = process.env.D1_API_KEY;

// --- D1 資料庫客戶端 (透過 Cloudflare Worker 代理) ---
// 這個物件會將所有資料庫操作，轉換成對我們另一個 Cloudflare Worker 的 API 呼叫
const d1Client = {
  async query(sql, params = []) {
    if (!D1_WORKER_URL || !D1_API_KEY) {
      throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set.");
    }
    try {
      const response = await axios.post(
        `${D1_WORKER_URL}/query`,
        { sql, params },
        { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } }
      );
      if (response.data && response.data.success) {
        return response.data.results;
      }
      throw new Error(response.data.error || "D1 query failed");
    } catch (error) {
      console.error("d1Client.query Error:", error.response ? error.response.data : error.message);
      throw new Error(`Failed to execute D1 query: ${error.message}`);
    }
  },
  
  async batch(statements) {
     if (!D1_WORKER_URL || !D1_API_KEY) {
      throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set.");
    }
     try {
      const response = await axios.post(
        `${D1_WORKER_URL}/batch`,
        { statements },
        { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } }
      );
      if (response.data && response.data.success) {
        return response.data.results;
      }
      throw new Error(response.data.error || "D1 batch operation failed");
    } catch (error) {
      console.error("d1Client.batch Error:", error.response ? error.response.data : error.message);
      throw new Error(`Failed to execute D1 batch: ${error.message}`);
    }
  }
};

// --- [第一部分：資料準備與抓取函式 (已修改)] ---

async function fetchAndSaveMarketData(symbol) {
  try {
    console.log(`Fetching full history for ${symbol} from Yahoo Finance...`);
    const hist = await yahooFinance.historical(symbol, { period1: '2000-01-01', interval: '1d' });
    
    const dbOps = [];
    const tableName = symbol.includes("=") ? "exchange_rates" : "price_history";

    dbOps.push({ sql: `DELETE FROM ${tableName} WHERE symbol = ?`, params: [symbol] });

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


// --- [第二部分：純計算輔助函式 (完全未修改)] ---
// 這部分的函式只負責數學計算，不涉及資料庫操作，因此完全沿用。

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
    const futureSplits = allEvts.filter(e => e.eventType === 'split' && toDate(e.date) > toDate(targetDate));

    for (const e of pastEvents) {
        const sym = e.symbol.toUpperCase();
        if (!state[sym]) state[sym] = { lots: [], currency: e.currency || "USD" };
        
        if (e.eventType === 'transaction') {
            state[sym].currency = e.currency;
            const fx = 1; 
            const costPerShareTWD = getTotalCost(e) / (e.quantity || 1) * fx;

            if (e.type === 'buy') {
                state[sym].lots.push({ quantity: e.quantity, pricePerShareTWD: costPerShareTWD });
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
            });
        }
    }

    for (const sym in state) {
        futureSplits
            .filter(s => s.symbol.toUpperCase() === sym)
            .forEach(split => {
                state[sym].lots.forEach(lot => {
                    lot.quantity *= split.ratio;
                });
            });
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
             const firstEventDate = toDate(s.lots[0]?.date || date);
             if (yesterday < firstEventDate) return totalValue;
             return totalValue + dailyValue({[sym]: s}, market, yesterday);
        }
        
        const fx = findFxRate(market, s.currency, date);
        return totalValue + (qty * price * (s.currency === "TWD" ? 1 : fx));
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
    return { evts, firstBuyDate: firstTx ? toDate(firstTx.date) : null, firstBuyDateMap };
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
        const stateOnDate = getPortfolioStateOnDate(evts, curDate);
        history[dateStr] = dailyValue(stateOnDate, market, curDate);
        curDate.setDate(curDate.getDate() + 1);
    }
    return history;
}

function calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, startDate) {
    const dates = Object.keys(dailyPortfolioValues).sort();
    if (!startDate || dates.length === 0) return { twrHistory: {}, benchmarkHistory: {} };

    const upperBenchmarkSymbol = benchmarkSymbol.toUpperCase();
    const benchmarkPrices = market[upperBenchmarkSymbol]?.prices || {};
    const benchmarkStartPrice = findNearest(benchmarkPrices, startDate);

    if (!benchmarkStartPrice) {
        console.log(`TWR_CALC_FAIL: Cannot find start price for benchmark ${upperBenchmarkSymbol} on ${startDate.toISOString().split('T')[0]}.`);
        return { twrHistory: {}, benchmarkHistory: {} };
    }

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
            const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.date));
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
        
        const currentBenchPrice = findNearest(benchmarkPrices, new Date(dateStr));
        if (currentBenchPrice) {
            benchmarkHistory[dateStr] = ((currentBenchPrice / benchmarkStartPrice) - 1) * 100;
        }
    }
    
    return { twrHistory, benchmarkHistory };
}

function calculateFinalHoldings(pf, market) {
  const holdingsToUpdate = {};
  const holdingsToDelete = [];
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
        const mktVal = qty * (curPrice ?? 0) * (h.currency === "TWD" ? 1 : fx);
        const unreal = mktVal - totCostTWD;
        const invested = totCostTWD + h.realizedCostTWD;
        const totalRet = unreal + h.realizedPLTWD;
        const rrCurrent = totCostTWD > 0 ? (unreal / totCostTWD) * 100 : 0;
        const rrTotal = invested > 0 ? (totalRet / invested) * 100 : 0;
        holdingsToUpdate[sym] = {
          symbol: sym, quantity: qty, currency: h.currency,
          avgCostOriginal: totCostOrg > 0 ? totCostOrg / qty : 0, totalCostTWD: totCostTWD, investedCostTWD: invested,
          currentPriceOriginal: curPrice ?? null, marketValueTWD: mktVal,
          unrealizedPLTWD: unreal, realizedPLTWD: h.realizedPLTWD,
          returnRateCurrent: rrCurrent, returnRateTotal: rrTotal, returnRate: rrCurrent
        };
    } else {
        holdingsToDelete.push(sym);
    }
  }
  return { holdingsToUpdate, holdingsToDelete };
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
        const stateOnDate = getPortfolioStateOnDate(evts, toDate(d.date));
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
                let fx;
                if (e.exchangeRate && e.currency !== 'TWD') {
                    fx = e.exchangeRate;
                } else {
                    fx = findFxRate(market, e.currency, toDate(e.date));
                }
                const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);

                if (e.type === "buy") {
                    pf[sym].lots.push({ quantity: e.quantity, pricePerShareOriginal: e.price, pricePerShareTWD: costTWD / e.quantity, date: toDate(e.date) });
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
                const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.date));
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
    const { holdingsToUpdate, holdingsToDelete } = calculateFinalHoldings(pf, market);
    const xirrFlows = createCashflowsForXirr(evts, holdingsToUpdate, market);
    const xirr = calculateXIRR(xirrFlows);
    const totalUnrealizedPL = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.unrealizedPLTWD, 0);
    const totalInvestedCost = Object.values(holdingsToUpdate).reduce((sum, h) => sum + h.totalCostTWD, 0) + Object.values(pf).reduce((sum, p) => sum + p.realizedCostTWD, 0);
    const totalReturnValue = totalRealizedPL + totalUnrealizedPL;
    const overallReturnRate = totalInvestedCost > 0 ? (totalReturnValue / totalInvestedCost) * 100 : 0;
    return { holdings: { holdingsToUpdate, holdingsToDelete }, totalRealizedPL, xirr, overallReturnRate };
}


// --- [第三部分：統一的 HTTP 觸發器] ---
// 這是我們整個後端服務唯一的入口點。

exports.unifiedPortfolioHandler = functions.https.onRequest(async (req, res) => {
    // 跨域請求設定 (CORS) - 允許來自任何來源的請求，方便初期開發
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');
      res.set('Access-Control-Max-Age', '3600');
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }
    
    // 安全性驗證：檢查 API Key 是否正確
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== D1_API_KEY) {
        console.warn("Unauthorized access attempt with invalid API key.");
        return res.status(401).send('Unauthorized');
    }

    // 從請求的 body 中取得要執行的動作和使用者 ID
    const { action, uid } = req.body;
    if (!action || !uid) {
        return res.status(400).send({ success: false, message: 'Bad Request: Missing action or uid.' });
    }

    try {
        switch (action) {
            case 'recalculate':
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: `Recalculation successful for ${uid}` });
            
            // 未來可以在此處新增更多 action，例如：
            // case 'fetchPrice':
            //   const { symbol } = req.body;
            //   const priceData = await fetchAndSaveMarketData(symbol);
            //   return res.status(200).send({ success: true, data: priceData });

            default:
                return res.status(400).send({ success: false, message: 'Unknown action' });
        }
    } catch (error) {
        console.error(`[${uid}] Handler failed for action '${action}':`, error);
        return res.status(500).send({ success: false, message: `An internal error occurred: ${error.message}` });
    }
  });
