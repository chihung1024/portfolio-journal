// =========================================================================================
// == GCP Cloud Function 安全性強化版 (v2.7.0 - Token 認證)
// =========================================================================================

const functions = require("firebase-functions");
const admin = require('firebase-admin'); // [新增] 引入 firebase-admin 套件
const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');

// [新增] 初始化 Firebase Admin SDK
// 在 Google Cloud 環境中，它會自動找到認證資訊，無需提供金鑰檔案
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

// --- [新增] 安全性中介軟體 (Middleware)，用於驗證 Firebase ID Token ---
// 這是我們新增加的「驗票員」函式
const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('請求被拒絕：缺少 Authorization Bearer Token。');
        res.status(403).send({ success: false, message: 'Unauthorized: Missing or invalid authorization token.'});
        return;
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        // 驗證成功後，將解碼出的使用者資訊（包含uid）附加到 req 物件上
        req.user = decodedToken;
        // 呼叫 next() 才會繼續執行後面的主要邏輯
        next();
    } catch (error) {
        console.error('Token 驗證失敗:', error.message);
        res.status(403).send({ success: false, message: 'Unauthorized: Token verification failed. 請嘗試重新登入。'});
    }
};

// --- [新增] Zod Schema 定義，用於驗證輸入資料 ---
const { z } = require("zod");

// 交易資料的規格
const transactionSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須為 YYYY-MM-DD"),
    symbol: z.string().min(1, "股票代碼為必填").transform(val => val.toUpperCase().trim()),
    type: z.enum(['buy', 'sell'], { errorMap: () => ({ message: "交易類型必須為 'buy' 或 'sell'" }) }),
    quantity: z.number().positive("股數必須為正數"),
    price: z.number().positive("價格必須為正數"),
    currency: z.enum(['USD', 'TWD', 'HKD', 'JPY'], { errorMap: () => ({ message: "不支援的幣別" }) }),
    totalCost: z.number().positive("總成本必須為正數").optional().nullable(),
    exchangeRate: z.number().positive("匯率必須為正數").optional().nullable(),
});

// 拆股事件的規格
const splitSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須為 YYYY-MM-DD"),
    symbol: z.string().min(1, "股票代碼為必填").transform(val => val.toUpperCase().trim()),
    ratio: z.number().positive("比例必須為正數"),
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


/**
 * [優化版] 從 D1 資料庫批次獲取所有市場數據。
 * 採用 `WHERE IN (...)` 的批次查詢方式，並透過 Promise.all 並行執行，以達到最高效能。
 * @param {Array} txs - 使用者的交易紀錄，用於分析需要的標的。
 * @param {string} benchmarkSymbol - 基準指標的代碼。
 * @returns {Object} - 包含所有價格、股利和匯率的 marketData 物件。
 */
async function getMarketDataFromDb(txs, benchmarkSymbol) {
    // --- 步驟 1: 分類所有需要查詢的代碼 ---
    const symbolsInPortfolio = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
    const currencies = [...new Set(txs.map(t => t.currency))].filter(c => c !== "TWD");
    const requiredFxSymbols = currencies.map(c => currencyToFx[c]).filter(Boolean);
    const requiredStockSymbols = [...new Set([...symbolsInPortfolio, benchmarkSymbol.toUpperCase()])].filter(Boolean);

    console.log(`[DB Read] 開始批次讀取市場數據...`);
    console.log(`[DB Read] 股票標的: ${requiredStockSymbols.join(', ') || '無'}`);
    console.log(`[DB Read] 匯率標的: ${requiredFxSymbols.join(', ') || '無'}`);

    const promises = [];
    
    // --- 步驟 2: 動態構建 SQL 並準備批次查詢 ---

    // 準備股票價格的批次查詢
    if (requiredStockSymbols.length > 0) {
        const placeholders = requiredStockSymbols.map(() => '?').join(',');
        const sql = `SELECT symbol, date, price FROM price_history WHERE symbol IN (${placeholders})`;
        promises.push(d1Client.query(sql, requiredStockSymbols));
    } else {
        promises.push(Promise.resolve([])); // 如果沒有股票，放入一個解析為空陣列的 Promise 以維持順序
    }

    // 準備股票股利的批次查詢
    if (requiredStockSymbols.length > 0) {
        const placeholders = requiredStockSymbols.map(() => '?').join(',');
        const sql = `SELECT symbol, date, dividend FROM dividend_history WHERE symbol IN (${placeholders})`;
        promises.push(d1Client.query(sql, requiredStockSymbols));
    } else {
        promises.push(Promise.resolve([]));
    }

    // 準備匯率的批次查詢
    if (requiredFxSymbols.length > 0) {
        const placeholders = requiredFxSymbols.map(() => '?').join(',');
        const sql = `SELECT symbol, date, price FROM exchange_rates WHERE symbol IN (${placeholders})`;
        promises.push(d1Client.query(sql, requiredFxSymbols));
    } else {
        promises.push(Promise.resolve([]));
    }

    // --- 步驟 3: 並行發起所有批次查詢 ---
    // 一次性等待所有大的批次查詢完成
    const [
        stockPricesFlat,    // 結果會是一個扁平的大陣列，例如 [{symbol: 'AAPL', ...}, {symbol: 'GOOG', ...}]
        stockDividendsFlat,
        fxRatesFlat
    ] = await Promise.all(promises);

    // --- 步驟 4: 重組扁平化的數據 ---
    const allSymbols = [...requiredStockSymbols, ...requiredFxSymbols];

    // 先建立好 marketData 的基本結構
    const marketData = allSymbols.reduce((acc, symbol) => {
        acc[symbol] = { prices: {}, dividends: {} };
        return acc;
    }, {});

    // 將股票價格數據填充進 marketData
    stockPricesFlat.forEach(row => {
        const date = row.date.split('T')[0];
        marketData[row.symbol].prices[date] = row.price;
    });

    // 將股利數據填充進 marketData
    stockDividendsFlat.forEach(row => {
        const date = row.date.split('T')[0];
        marketData[row.symbol].dividends[date] = row.dividend;
    });

    // 將匯率數據填充進 marketData，並同時建立 .rates 屬性
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
    // 先正常建立 Date 物件
    const d = v.toDate ? v.toDate() : new Date(v);
    
    // [關鍵修正] 檢查 d 是否為一個有效的 Date 物件
    if (d instanceof Date && !isNaN(d)) {
      // 將此時間點的 UTC 時間強制設為午夜零時，消除本地時區造成的偏移
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
      
        // --- [新增] 批次切割 (Chunking) 邏輯 ---
    
        // 1. 將固定大小的 summary 操作與可能非常大的 holdings 操作分開
        const summaryOps = [
            { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
            {
                sql: `INSERT INTO portfolio_summary (uid, summary_data, history, twrHistory, benchmarkHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?)`,
                params: [uid, JSON.stringify(summaryData), JSON.stringify(dailyPortfolioValues), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), new Date().toISOString()]
            }
        ];
    
        // 先執行 summary 的更新
        await d1Client.batch(summaryOps);
        console.log(`[${uid}] Summary data updated successfully.`);
    
        // 2. 對 holdings 操作 (dbOps) 進行切割
        const BATCH_SIZE = 900; // 設定一個安全的批次大小，略小於1000以保留緩衝
        const dbOpsChunks = [];
        for (let i = 0; i < dbOps.length; i += BATCH_SIZE) {
            dbOpsChunks.push(dbOps.slice(i, i + BATCH_SIZE));
        }
    
        console.log(`[${uid}] Holdings data will be updated in ${dbOpsChunks.length} batches of up to ${BATCH_SIZE} statements each.`);
    
        // 3. 透過 Promise.all 並行執行所有切割後的批次任務，以提升效率
        await Promise.all(
            dbOpsChunks.map((chunk, index) => {
                console.log(`[${uid}] Executing holdings batch #${index + 1} with ${chunk.length} statements...`);
                return d1Client.batch(chunk);
            })
        );
        
        console.log(`--- [${uid}] 重新計算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 計算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

// --- [修改] API 端點處理，整合「驗票員」中介軟體 ---
exports.unifiedPortfolioHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    // 處理 CORS 跨域請求 (請務必將 'Authorization' 和 'X-Service-Account-Key' 加入 Allow-Headers)
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

    // API Key 檢查仍然可以作為第一層基礎防護
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== D1_API_KEY) {
        return res.status(401).send({ success: false, message: 'Unauthorized: Invalid API Key' });
    }

    // --- [新增] 服務帳號金鑰檢查 ---
    const serviceAccountKey = req.headers['x-service-account-key'];
    const SERVICE_ACCOUNT_KEY_FROM_ENV = process.env.SERVICE_ACCOUNT_KEY;

    // 如果是來自後端服務的請求
    if (serviceAccountKey && serviceAccountKey === SERVICE_ACCOUNT_KEY_FROM_ENV) {
        const { action } = req.body;
        if (action === 'recalculate_all_users') {
            try {
                console.log('[Service Account] 收到全體使用者重算請求...');
                const allUidsResult = await d1Client.query('SELECT DISTINCT uid FROM transactions');
                const allUids = allUidsResult.map(row => row.uid);
                
                console.log(`[Service Account] 將為 ${allUids.length} 位使用者進行重算。`);
                for (const uid of allUids) {
                    console.log(`[Service Account] 正在重算 UID: ${uid}`);
                    await performRecalculation(uid);
                }
                
                console.log('[Service Account] 全體使用者重算成功。');
                return res.status(200).send({ success: true, message: '所有使用者重算成功。' });
            } catch (error) {
                console.error('[Service Account] 重算過程中發生錯誤:', error);
                return res.status(500).send({ success: false, message: `重算過程中發生錯誤: ${error.message}` });
            }
        }
        return res.status(400).send({ success: false, message: '無效的服務操作。' });
    }
    // --- 服務帳號邏輯結束 ---


    // [關鍵整合] 如果不是服務帳號請求，則執行正常的使用者 Token 驗證流程
    await verifyFirebaseToken(req, res, async () => {
        // --- 如果 Token 驗證成功，以下的主要邏輯才會被執行 ---
        try {
            // [關鍵修改] UID 現在從 req.user 中獲取，這是由中介軟體驗證後設定的，絕對安全。
            const uid = req.user.uid; 
            const { action, data } = req.body;

            if (!action) {
                return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });
            }

            // 您的 switch 邏輯完全不需要修改，因為它們使用的 uid 變數已經是安全的了
            switch (action) {
            case 'get_data': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const [txs, splits, holdingsResult, summaryResult, stockNotes] = await Promise.all([
                    d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
                    d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
                    d1Client.query('SELECT * FROM holdings WHERE uid = ? ORDER BY marketValueTWD DESC', [uid]),
                    d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ?', [uid]),
                    d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid]) // [修改] 一併獲取筆記
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
                        stockNotes, // [修改] 將筆記資料回傳給前端
                        history, twrHistory, benchmarkHistory,
                        marketData
                    }
                });
            }

            case 'add_transaction':
            case 'edit_transaction': {
                try {
                    const isEditing = action === 'edit_transaction';
                    // 步驟一：使用 Zod schema 來解析和驗證輸入資料
                    // 注意：這裡的 data 依然是 req.body.data
                    const txData = transactionSchema.parse(isEditing ? data.txData : data);
                    
                    // --- 驗證通過後，才執行完整的資料庫邏輯 ---
                    const txId = isEditing ? data.txId : uuidv4();

                    if (isEditing) {
                        // 使用驗證後乾淨的 txData 物件來更新資料庫
                        await d1Client.query(
                            `UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`,
                            [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]
                        );
                    } else {
                        // 使用驗證後乾淨的 txData 物件來新增資料庫
                        await d1Client.query(
                            `INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]
                        );
                    }
                    
                    await performRecalculation(uid);
                    return res.status(200).send({ success: true, message: '操作成功並觸發重新計算。', id: txId });

                } catch (error) {
                    // 如果 Zod 驗證失敗，會在此被捕獲
                    if (error instanceof z.ZodError) {
                        console.warn(`[Validation Error] for ${action}:`, error.errors);
                        return res.status(400).send({ success: false, message: "輸入資料格式錯誤", errors: error.errors });
                    }
                    // 其他非預期的錯誤則拋給外層的 try-catch 處理
                    throw error;
                }
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
                try {
                    // [關鍵修改] 使用 Zod schema 來解析和驗證輸入資料
                    const splitData = splitSchema.parse(data);
            
                    // --- 驗證通過後，才執行原有邏輯 ---
                    const newSplitId = uuidv4();
                    await d1Client.query(`INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`, [newSplitId, uid, splitData.date, splitData.symbol, splitData.ratio]);
                    await performRecalculation(uid);
                    return res.status(200).send({ success: true, message: '分割事件已新增並觸發重新計算。', splitId: newSplitId });
            
                } catch (error) {
                    if (error instanceof z.ZodError) {
                        console.warn('[Validation Error] for add_split:', error.errors);
                        return res.status(400).send({ success: false, message: "輸入資料格式錯誤", errors: error.errors });
                    }
                    throw error;
                }
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

            // [新增] 獲取單一股票筆記的 Action
            case 'get_stock_note': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const { symbol } = data;
                if (!symbol) return res.status(400).send({ success: false, message: '請求錯誤：缺少 symbol。' });

                const results = await d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ? AND symbol = ?', [uid, symbol]);
                return res.status(200).send({ success: true, data: results[0] || {} });
            }

            // [新增] 儲存股票筆記的 Action
            case 'save_stock_note': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const { symbol, target_price, stop_loss_price, notes } = data;
                if (!symbol) return res.status(400).send({ success: false, message: '請求錯誤：缺少 symbol。' });

                const existing = await d1Client.query('SELECT id FROM user_stock_notes WHERE uid = ? AND symbol = ?', [uid, symbol]);
                
                if (existing.length > 0) {
                    // 更新現有紀錄
                    await d1Client.query(
                        'UPDATE user_stock_notes SET target_price = ?, stop_loss_price = ?, notes = ?, last_updated = ? WHERE id = ?',
                        [target_price, stop_loss_price, notes, new Date().toISOString(), existing[0].id]
                    );
                } else {
                    // 插入新紀錄
                    await d1Client.query(
                        'INSERT INTO user_stock_notes (id, uid, symbol, target_price, stop_loss_price, notes, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [uuidv4(), uid, symbol, target_price, stop_loss_price, notes, new Date().toISOString()]
                    );
                }
                // 儲存筆記後，不需要觸發完整的重算，因為它不影響核心財務指標
                return res.status(200).send({ success: true, message: '筆記已儲存。' });
            }

            default:
                return res.status(400).send({ success: false, message: '未知的操作' });
        }
        } catch (error) {
            const errorMessage = error.message || 'An unknown error occurred.';
            console.error(`[${req.user?.uid || 'N/A'}] 在執行 action: '${req.body?.action}' 時發生錯誤:`, error);
            res.status(500).send({ success: false, message: `伺服器內部錯誤：${errorMessage}` });
        }
    });
});
