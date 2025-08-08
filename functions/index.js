// =========================================================================================
// == GCP Cloud Function 完全免費 Rate Limiting 版 (v3.6.0 - 最終完整版)
// =========================================================================================

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");

try {
  admin.initializeApp();
  console.log('Firebase Admin SDK 初始化成功。');
} catch (e) {
  console.error('Firebase Admin SDK 初始化失敗:', e);
}

// --- 平台設定 ---
const D1_WORKER_URL = process.env.D1_WORKER_URL;
const D1_API_KEY = process.env.D1_API_KEY;

// --- 完全免費的記憶體內 Rate Limiting ---
const userRequestMap = new Map();
const ipRequestMap = new Map();
const alertsSent = new Set(); // 防止重複警報

// 清理過期記錄（避免記憶體洩漏）
function cleanupExpiredRequests() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [key, requests] of userRequestMap.entries()) {
    const validRequests = requests.filter(time => now - time < oneHour);
    if (validRequests.length === 0) {
      userRequestMap.delete(key);
    } else {
      userRequestMap.set(key, validRequests);
    }
  }
  
  // 對IP記錄做同樣清理
  for (const [key, requests] of ipRequestMap.entries()) {
    const validRequests = requests.filter(time => now - time < oneHour);
    if (validRequests.length === 0) {
      ipRequestMap.delete(key);
    } else {
      ipRequestMap.set(key, validRequests);
    }
  }
  
  // 清理警報記錄（每小時重置）
  const hourAgo = Math.floor((now - oneHour) / 3600000);
  const currentHour = Math.floor(now / 3600000);
  for (const alertKey of alertsSent) {
    const alertHour = parseInt(alertKey.split('_').pop());
    if (alertHour < currentHour) {
      alertsSent.delete(alertKey);
    }
  }
}

// 免費Rate Limiting檢查
function checkRateLimit(identifier, type, action) {
  const now = Date.now();
  
  // 不同操作的限制設定（完全免費，無額外成本）
  const limits = {
    user: {
      'get_data': 50,                    // 每分鐘50次
      'add_transaction': 20,             // 每分鐘20次
      'edit_transaction': 15,            // 每分鐘15次
      'delete_transaction': 10,          // 每分鐘10次
      'bulk_confirm_all_dividends': 3,   // 每分鐘3次（重型操作）
      'recalculate_all_users': 1,        // 每分鐘1次（管理員操作）
      'default': 30                      // 其他操作30次
    },
    ip: {
      'get_data': 100,                   // 每分鐘100次
      'add_transaction': 40,             // 每分鐘40次
      'edit_transaction': 30,            // 每分鐘30次
      'delete_transaction': 20,          // 每分鐘20次
      'bulk_confirm_all_dividends': 5,   // 每分鐘5次
      'recalculate_all_users': 2,        // 每分鐘2次
      'default': 60                      // 其他操作60次
    }
  };
  
  const limit = limits[type][action] || limits[type].default;
  const windowMs = 60 * 1000; // 1分鐘窗口
  const windowStart = now - windowMs;
  
  const requestMap = type === 'user' ? userRequestMap : ipRequestMap;
  const key = `${type}_${identifier}_${action}`;
  
  if (!requestMap.has(key)) {
    requestMap.set(key, []);
  }
  
  const requests = requestMap.get(key);
  const recentRequests = requests.filter(time => time > windowStart);
  
  if (recentRequests.length >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: recentRequests[0] + windowMs,
      limitType: type,
      limit: limit
    };
  }
  
  recentRequests.push(now);
  requestMap.set(key, recentRequests);
  
  return {
    allowed: true,
    remaining: limit - recentRequests.length,
    resetTime: now + windowMs,
    limitType: type,
    limit: limit
  };
}

// 免費警報系統（使用 console.log，無額外成本）
function logSecurityAlert(alertData) {
  const alertKey = `${alertData.identifier}_${alertData.action}_${Math.floor(Date.now() / 3600000)}`;
  
  if (!alertsSent.has(alertKey)) {
    console.warn(`🚨 [SECURITY_ALERT] ${alertData.event}: ${alertData.identifier} - ${alertData.action} at ${new Date().toISOString()}`);
    alertsSent.add(alertKey);
  }
}

// D1 資料庫客戶端
const d1Client = {
  async query(sql, params = []) {
    if (!D1_WORKER_URL || !D1_API_KEY) { 
      throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set."); 
    }

    try {
      const response = await axios.post(`${D1_WORKER_URL}/query`, { sql, params }, { 
        headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } 
      });

      if (response.data && response.data.success) { 
        return response.data.results; 
      }

      throw new Error(response.data.error || "D1 查詢失敗");
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
      const response = await axios.post(`${D1_WORKER_URL}/batch`, { statements }, { 
        headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } 
      });

      if (response.data && response.data.success) { 
        return response.data.results; 
      }

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

// --- 核心函式（保持原有邏輯，此處省略詳細內容以節省空間）---
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
  } else {
    promises.push(Promise.resolve([]), Promise.resolve([]));
  }

  if (requiredFxSymbols.length > 0) {
    const p2 = requiredFxSymbols.map(() => '?').join(',');
    promises.push(d1Client.query(`SELECT symbol, date, price FROM exchange_rates WHERE symbol IN (${p2})`, requiredFxSymbols));
  } else {
    promises.push(Promise.resolve([]));
  }

  const [stockPricesFlat, stockDividendsFlat, fxRatesFlat] = await Promise.all(promises);

  const allSymbols = [...requiredStockSymbols, ...requiredFxSymbols];
  const marketData = allSymbols.reduce((acc, symbol) => ({...acc, [symbol]: { prices: {}, dividends: {} }}), {});

  stockPricesFlat.forEach(row => { marketData[row.symbol].prices[row.date.split('T')[0]] = row.price; });
  stockDividendsFlat.forEach(row => { marketData[row.symbol].dividends[row.date.split('T')[0]] = row.dividend; });
  fxRatesFlat.forEach(row => { marketData[row.symbol].prices[row.date.split('T')[0]] = row.price; });

  requiredFxSymbols.forEach(fxSymbol => { 
    if(marketData[fxSymbol]) marketData[fxSymbol].rates = marketData[fxSymbol].prices; 
  });

  return marketData;
}

const toDate = v => { 
  if (!v) return null; 
  const d = v.toDate ? v.toDate() : new Date(v); 
  if (d instanceof Date && !isNaN(d)) d.setUTCHours(0, 0, 0, 0); 
  return d; 
};

const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
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
  return findNearest(market[fxSym]?.rates || {}, date, tolerance) ?? 1; 
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

function prepareEvents(txs, splits, market, userDividends) { 
  const firstBuyDateMap = {}; 
  txs.forEach(tx => { 
    if (tx.type === "buy") { 
      const sym = tx.symbol.toUpperCase(); 
      const d = toDate(tx.date); 
      if (!firstBuyDateMap[sym] || d < firstBuyDateMap[sym]) firstBuyDateMap[sym] = d; 
    }
  }); 

  const evts = [ 
    ...txs.map(t => ({ ...t, eventType: "transaction" })), 
    ...splits.map(s => ({ ...s, eventType: "split" })) 
  ]; 

  const confirmedDividendKeys = new Set(userDividends.map(d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`)); 

  userDividends.forEach(ud => evts.push({ 
    eventType: 'confirmed_dividend', 
    date: toDate(ud.pay_date), 
    symbol: ud.symbol.toUpperCase(), 
    amount: ud.total_amount, 
    currency: ud.currency 
  })); 

  Object.keys(market).forEach(sym => { 
    if (market[sym]?.dividends) { 
      Object.entries(market[sym].dividends).forEach(([dateStr, amount]) => { 
        const dividendDate = toDate(dateStr); 
        if (confirmedDividendKeys.has(`${sym.toUpperCase()}_${dateStr}`)) return; 
        if (firstBuyDateMap[sym] && dividendDate >= firstBuyDateMap[sym] && amount > 0) { 
          const payDate = new Date(dividendDate); 
          payDate.setMonth(payDate.getMonth() + 1); 
          evts.push({ 
            eventType: "implicit_dividend", 
            date: payDate, 
            ex_date: dividendDate, 
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
    history[dateStr] = dailyValue(getPortfolioStateOnDate(evts, curDate, market), market, curDate, evts); 
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
    
    if (e.eventType === 'transaction') { 
      const currency = e.currency || 'USD'; 
      const fx = (e.exchangeRate && currency !== 'TWD') ? e.exchangeRate : findFxRate(market, currency, toDate(e.date)); 
      flow = (e.type === 'buy' ? 1 : -1) * getTotalCost(e) * (currency === 'TWD' ? 1 : fx); 
    } else if (e.eventType === 'confirmed_dividend') { 
      const fx = findFxRate(market, e.currency, toDate(e.date)); 
      flow = -1 * e.amount * (e.currency === 'TWD' ? 1 : fx); 
    } else if (e.eventType === 'implicit_dividend') { 
      const stateOnDate = getPortfolioStateOnDate(evts, toDate(e.ex_date), market); 
      const shares = stateOnDate[e.symbol.toUpperCase()]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0; 
      if (shares > 0) { 
        const currency = stateOnDate[e.symbol.toUpperCase()]?.currency || 'USD'; 
        const fx = findFxRate(market, currency, toDate(e.date)); 
        const postTaxAmount = e.amount_per_share * (1 - (isTwStock(e.symbol) ? 0.0 : 0.30)); 
        flow = -1 * postTaxAmount * shares * fx; 
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
    if (denominator !== 0) cumulativeHpr *= MVE / denominator; 
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
      
      const futureSplits = allEvts.filter(e => 
        e.eventType === 'split' && 
        e.symbol.toUpperCase() === sym.toUpperCase() && 
        toDate(e.date) > today
      ); 
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

function createCashflowsForXirr(evts, holdings, market) { 
  const flows = []; 
  
  evts.forEach(e => { 
    let amt = 0, flowDate = toDate(e.date); 
    
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
    
    if (Math.abs(amt) > 1e-6) flows.push({ date: flowDate, amount: amt }); 
  }); 

  const totalMarketValue = Object.values(holdings).reduce((s, h) => s + h.marketValueTWD, 0); 
  if (totalMarketValue > 0) flows.push({ date: new Date(), amount: totalMarketValue }); 

  const combined = flows.reduce((acc, flow) => { 
    const dateStr = flow.date.toISOString().slice(0, 10); 
    acc[dateStr] = (acc[dateStr] || 0) + flow.amount; 
    return acc; 
  }, {}); 

  return Object.entries(combined).filter(([, amount]) => Math.abs(amount) > 1e-6).map(([date, amount]) => ({ 
    date: new Date(date), 
    amount 
  })).sort((a, b) => a.date - b.date); 
}

function calculateXIRR(flows) { 
  if (flows.length < 2) return null; 
  
  const amounts = flows.map(f => f.amount); 
  if (!amounts.some(v => v < 0) || !amounts.some(v => v > 0)) return null; 

  const dates = flows.map(f => f.date); 
  const epoch = dates[0].getTime(); 
  const years = dates.map(d => (d.getTime() - epoch) / (365.25 * 24 * 60 * 60 * 1000)); 

  let guess = 0.1, npv; 
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

async function performRecalculation(uid) {
  try {
    const [txs, splits, userDividends, benchmark] = await Promise.all([
      d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
      d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date ASC', [uid]),
      d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY ex_dividend_date ASC', [uid]),
      d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol'])
    ]);

    if (txs.length === 0) {
      await d1Client.query('DELETE FROM holdings WHERE uid = ?', [uid]);
      await d1Client.query('DELETE FROM portfolio_summary WHERE uid = ?', [uid]);
      return;
    }

    const benchmarkSymbol = benchmark[0]?.value || 'SPY';
    const earliestDate = new Date(Math.min(...txs.map(t => new Date(t.date))));
    const earliestDateStr = earliestDate.toISOString().split('T')[0];
    const allSymbols = [...new Set(txs.map(t => t.symbol.toUpperCase()))];

    for (const symbol of allSymbols) {
      await ensureDataCoverage(symbol, earliestDateStr);
    }
    await ensureDataCoverage(benchmarkSymbol, earliestDateStr);
    await ensureDataFreshness([...allSymbols, benchmarkSymbol]);

    const market = await getMarketDataFromDb(txs, benchmarkSymbol);
    const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);
    const dailyPortfolioValues = calculateDailyPortfolioValues(evts, market, firstBuyDate);
    const { twrHistory, benchmarkHistory } = calculateTwrHistory(dailyPortfolioValues, evts, market, benchmarkSymbol, firstBuyDate);
    const portfolioState = getPortfolioStateOnDate(evts, new Date(), market);
    const { holdingsToUpdate } = calculateFinalHoldings(portfolioState, market, evts);

    const totalMarketValue = Object.values(holdingsToUpdate).reduce((s, h) => s + h.marketValueTWD, 0);
    const totalUnrealizedPL = Object.values(holdingsToUpdate).reduce((s, h) => s + h.unrealizedPLTWD, 0);
    const totalRealizedPL = Object.values(holdingsToUpdate).reduce((s, h) => s + (h.realizedPLTWD || 0), 0);
    const overallReturnRate = totalMarketValue > 0 ? (totalUnrealizedPL / (totalMarketValue - totalUnrealizedPL)) * 100 : 0;
    const xirr = calculateXIRR(createCashflowsForXirr(evts, holdingsToUpdate, market));

    await d1Client.query('DELETE FROM holdings WHERE uid = ?', [uid]);
    const holdingInserts = Object.values(holdingsToUpdate).map(h => ({
      sql: `INSERT INTO holdings (uid, symbol, quantity, currency, avgCostOriginal, totalCostTWD, currentPriceOriginal, marketValueTWD, unrealizedPLTWD, realizedPLTWD, returnRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [uid, h.symbol, h.quantity, h.currency, h.avgCostOriginal, h.totalCostTWD, h.currentPriceOriginal, h.marketValueTWD, h.unrealizedPLTWD, h.realizedPLTWD || 0, h.returnRate]
    }));
    
    if (holdingInserts.length > 0) await d1Client.batch(holdingInserts);

    const summaryData = {
      totalMarketValueTWD: totalMarketValue,
      totalUnrealizedPLTWD: totalUnrealizedPL,
      totalRealizedPL: totalRealizedPL,
      overallReturnRate: overallReturnRate,
      xirr: xirr,
      benchmarkSymbol: benchmarkSymbol
    };

    await d1Client.query(`INSERT OR REPLACE INTO portfolio_summary (uid, summary_data, history, twrHistory, benchmarkHistory) VALUES (?, ?, ?, ?, ?)`, [
      uid,
      JSON.stringify(summaryData),
      JSON.stringify(dailyPortfolioValues),
      JSON.stringify(twrHistory),
      JSON.stringify({ ...benchmarkHistory, benchmarkSymbol })
    ]);

  } catch (error) {
    console.error(`重算失敗 (uid: ${uid}):`, error);
    throw error;
  }
}

// --- 主要 Cloud Function ---
exports.unifiedPortfolioHandler = functions
  .region('asia-east1')
  .runWith({
    timeoutSeconds: 540,
    memory: '2GB'
  })
  .https.onRequest(async (req, res) => {
    // === 強化版 CORS 設定（在所有處理前執行）===
    const allowedOrigins = [
      'https://www.911330.xyz',
      'https://911330.xyz', 
      'http://localhost:3000', // 本地開發用
      'http://localhost:8080'  // 本地開發用
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
    } else {
      // 如果來源不在允許清單中，仍允許但記錄
      console.log(`Unknown origin: ${origin}`);
      res.set('Access-Control-Allow-Origin', '*'); // 暫時允許所有來源
    }

    // 設定其他 CORS 標頭
    res.set({
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Origin, Content-Type, Accept, Authorization, X-Requested-With, X-API-KEY, X-Service-Account-Key',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400' // 24小時
    });

    // === 處理 OPTIONS 預檢請求 ===
    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS preflight request');
      res.status(204).send('');
      return;
    }

    // === 非 POST 請求處理 ===
    if (req.method !== 'POST') {
      console.log(`Received ${req.method} request, only POST allowed`);
      return res.status(405).send({ 
        success: false, 
        message: 'Method not allowed. Only POST requests are accepted.' 
      });
    }

    // === 每100個請求清理一次過期記錄（免費記憶體管理）===
    if (Math.random() < 0.01) {
      cleanupExpiredRequests();
    }

    // === 服務帳號特殊處理（管理員操作）===
    const serviceAccountKey = req.headers['x-service-account-key'];
    if (serviceAccountKey) {
      if (serviceAccountKey !== D1_API_KEY) {
        return res.status(401).send({ success: false, message: 'Invalid D1 API Key for Service Account' });
      }

      if (req.body.action === 'recalculate_all_users') {
        try {
          const allUidsResult = await d1Client.query('SELECT DISTINCT uid FROM transactions');
          for (const row of allUidsResult) { 
            await performRecalculation(row.uid); 
          }
          return res.status(200).send({ success: true, message: '所有使用者重算成功。' });
        } catch (error) { 
          return res.status(500).send({ success: false, message: `重算過程中發生錯誤: ${error.message}` }); 
        }
      }

      return res.status(400).send({ success: false, message: '無效的服務操作。' });
    }

    // === Firebase Token 驗證 ===
    try {
      await new Promise((resolve, reject) => {
        verifyFirebaseToken(req, res, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch (error) {
      return; // verifyFirebaseToken 已經處理了回應
    }

    const uid = req.user.uid;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.headers['x-real-ip'] || 
                     req.connection?.remoteAddress || 'unknown';
    
    const { action, data } = req.body;
    
    if (!action) {
      return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });
    }

    // === 免費 Rate Limiting 檢查 ===
    try {
      // 用戶級別檢查
      const userCheck = checkRateLimit(uid, 'user', action);
      if (!userCheck.allowed) {
        // 記錄安全警報
        logSecurityAlert({
          event: 'User Rate Limit Exceeded',
          identifier: uid,
          action: action
        });

        return res.status(429).json({
          success: false,
          message: '操作過於頻繁，請稍後再試。',
          retryAfter: Math.ceil((userCheck.resetTime - Date.now()) / 1000),
          rateLimitInfo: {
            type: 'user',
            limit: userCheck.limit,
            remaining: userCheck.remaining,
            resetTime: new Date(userCheck.resetTime).toISOString()
          }
        });
      }
      
      // IP級別檢查
      const ipCheck = checkRateLimit(clientIP, 'ip', action);
      if (!ipCheck.allowed) {
        // 記錄安全警報
        logSecurityAlert({
          event: 'IP Rate Limit Exceeded',
          identifier: clientIP,
          action: action
        });

        return res.status(429).json({
          success: false,
          message: '來自此網路的請求過於頻繁，請稍後再試。',
          retryAfter: Math.ceil((ipCheck.resetTime - Date.now()) / 1000),
          rateLimitInfo: {
            type: 'ip',
            limit: ipCheck.limit,
            remaining: ipCheck.remaining,
            resetTime: new Date(ipCheck.resetTime).toISOString()
          }
        });
      }
      
      // 設定 Rate Limit 回應標頭（讓前端知道使用狀況）
      res.set({
        'X-RateLimit-Limit-User': userCheck.limit.toString(),
        'X-RateLimit-Remaining-User': userCheck.remaining.toString(),
        'X-RateLimit-Reset-User': new Date(userCheck.resetTime).toISOString(),
        'X-RateLimit-Limit-IP': ipCheck.limit.toString(),
        'X-RateLimit-Remaining-IP': ipCheck.remaining.toString(),
        'X-RateLimit-Reset-IP': new Date(ipCheck.resetTime).toISOString()
      });
      
    } catch (rateLimitError) {
      console.error('Rate limiting error:', rateLimitError);
      // Rate limiting 錯誤不應中斷正常業務流程
    }

    // === 業務邏輯處理 ===
    try {
      console.log(`[${uid}] Processing action: ${action}`);

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

          return res.status(200).send({ 
            success: true, 
            data: {
              summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
              holdings, 
              transactions: txs, 
              splits, 
              stockNotes,
              history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
              twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
              benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
              marketData: {} // 前端不需要完整市場數據
            }
          });
        }

        case 'add_transaction': 
        case 'edit_transaction': {
          const isEditing = action === 'edit_transaction';
          const txData = transactionSchema.parse(isEditing ? data.txData : data);
          const txId = isEditing ? data.txId : uuidv4();

          if (isEditing) {
            await d1Client.query(`UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`, 
              [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]);
          } else {
            await d1Client.query(`INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
              [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]);
          }

          await performRecalculation(uid);
          return res.status(200).send({ success: true, message: '操作成功。', id: txId });
        }

        case 'delete_transaction': {
          await d1Client.query('DELETE FROM transactions WHERE id = ? AND uid = ?', [data.txId, uid]);
          await performRecalculation(uid); 
          return res.status(200).send({ success: true, message: '交易已刪除。' });
        }

        case 'update_benchmark': {
          await d1Client.query('INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)', [uid, 'benchmarkSymbol', data.benchmarkSymbol.toUpperCase()]);
          await performRecalculation(uid); 
          return res.status(200).send({ success: true, message: '基準已更新。' });
        }

        case 'add_split': {
          const splitData = splitSchema.parse(data); 
          const newSplitId = uuidv4();
          await d1Client.query(`INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`, [newSplitId, uid, splitData.date, splitData.symbol, splitData.ratio]);
          await performRecalculation(uid); 
          return res.status(200).send({ success: true, message: '分割事件已新增。', splitId: newSplitId });
        }

        case 'delete_split': {
          await d1Client.query('DELETE FROM splits WHERE id = ? AND uid = ?', [data.splitId, uid]);
          await performRecalculation(uid); 
          return res.status(200).send({ success: true, message: '分割事件已刪除。' });
        }

        case 'get_dividends_for_management': {
          const [txs, allDividendsHistory, userDividends] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM dividend_history ORDER BY date ASC'),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid])
          ]);

          if (txs.length === 0) {
            return res.status(200).send({ success: true, data: { pendingDividends: [], confirmedDividends: userDividends } });
          }

          const holdings = {}; 
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

            while(txIndex < txs.length && new Date(txs[txIndex].date) <= exDateMinusOne) {
              const tx = txs[txIndex]; 
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
            await d1Client.query(`UPDATE user_dividends SET pay_date = ?, total_amount = ?, tax_rate = ?, notes = ? WHERE id = ? AND uid = ?`,
              [divData.pay_date, divData.total_amount, divData.tax_rate, divData.notes, id, uid]);
          } else {
            await d1Client.query(`INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`, 
              [dividendId, uid, divData.symbol, divData.ex_dividend_date, divData.pay_date, divData.amount_per_share, divData.quantity_at_ex_date, divData.total_amount, divData.tax_rate, divData.currency, divData.notes]);
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
              sql: `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
              params: [uuidv4(), uid, pending.symbol, pending.ex_dividend_date, payDateStr, pending.amount_per_share, pending.quantity_at_ex_date, totalAmount, taxRate, pending.currency, `系統自動確認`, 'confirmed']
            });
          }

          await d1Client.batch(dbOps);
          await performRecalculation(uid);
          return res.status(200).send({ success: true, message: `已批次確認 ${pendingDividends.length} 筆配息紀錄。` });
        }

        case 'delete_user_dividend': {
          await d1Client.query('DELETE FROM user_dividends WHERE id = ? AND uid = ?', [data.dividendId, uid]);
          await performRecalculation(uid);
          return res.status(200).send({ success: true, message: '配息紀錄已刪除。' });
        }

        case 'save_stock_note': {
          const noteData = data;
          await d1Client.query(`INSERT OR REPLACE INTO user_stock_notes (uid, symbol, target_price, stop_loss_price, notes) VALUES (?, ?, ?, ?, ?)`, 
            [uid, noteData.symbol, noteData.target_price, noteData.stop_loss_price, noteData.notes]);
          return res.status(200).send({ success: true, message: '筆記已儲存。' });
        }

        default:
          return res.status(400).send({ 
            success: false, 
            message: '未知的操作：' + action 
          });
      }

    } catch (error) {
      console.error(`[${uid}] 執行 action: '${action}' 時發生錯誤:`, error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).send({
          success: false,
          message: "輸入資料格式驗證失敗",
          errors: error.errors
        });
      }

      res.status(500).send({
        success: false,
        message: `伺服器內部錯誤：${error.message}`
      });
    }
  });
