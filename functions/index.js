// =========================================================================================
// == GCP Cloud Function 安全性強化版 (v3.1 - 日期修正版)
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
  console.error('Firebase Admin SDK 初始化失敗，請檢查環境設定。', e);
}

const D1_WORKER_URL = process.env.D1_WORKER_URL;
const D1_API_KEY = process.env.D1_API_KEY;

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

const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(403).send({ success: false, message: 'Unauthorized: Missing or invalid authorization token.'});
        return;
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        req.user = await admin.auth().verifyIdToken(idToken);
        next();
    } catch (error) {
        res.status(403).send({ success: false, message: 'Unauthorized: Token verification failed. 請嘗試重新登入。'});
    }
};

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

// [CORE FIX] Consolidating all date-related logic into a single, reliable utility.
const DateUtil = {
    // Always returns a 'YYYY-MM-DD' string from various inputs.
    toYMD(v) {
        if (!v) return null;
        // If it's already a string with 'T', split it.
        if (typeof v === 'string' && v.includes('T')) {
            return v.split('T')[0];
        }
        // For Date objects or other string formats, convert to ISO string first.
        try {
            return new Date(v).toISOString().split('T')[0];
        } catch (e) {
            return null;
        }
    },
    // Creates a standardized UTC Date object for calculations if needed.
    toDate(v) {
        const ymd = this.toYMD(v);
        if (!ymd) return null;
        const d = new Date(`${ymd}T00:00:00.000Z`);
        return d;
    }
};

const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };
const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
const getTotalCost = (tx) => (tx.totalCost != null) ? Number(tx.totalCost) : Number(tx.price || 0) * Number(tx.quantity || 0);

// ... (fetchAndSaveMarketDataRange and ensureDataCoverage remain the same) ...

// [CORE FIX] The main function to fix the date comparison logic.
function getPortfolioStateOnDate(allSortedEvents, targetDate, market) {
    const state = {};
    const targetDateStr = DateUtil.toYMD(targetDate);

    // Filter events by comparing 'YYYY-MM-DD' strings directly.
    const pastEvents = allSortedEvents.filter(e => DateUtil.toYMD(e.date) <= targetDateStr);

    for (const e of pastEvents) {
        const sym = e.symbol.toUpperCase();
        if (!state[sym]) state[sym] = { lots: [], currency: e.currency || "USD" };

        if (e.eventType === 'transaction') {
            state[sym].currency = e.currency;
            if (e.type === 'buy') {
                const fx = findFxRate(market, e.currency, DateUtil.toDate(e.date));
                const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);
                state[sym].lots.push({
                    quantity: e.quantity,
                    pricePerShareTWD: costTWD / (e.quantity || 1),
                    pricePerShareOriginal: e.price,
                    date: DateUtil.toDate(e.date)
                });
            } else { // sell
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

// [CORE FIX] This function now receives a pre-sorted list of events.
function prepareEvents(txs, splits, userDividends) {
    const evts = [
        ...txs.map(t => ({ ...t, eventType: "transaction" })),
        ...splits.map(s => ({ ...s, eventType: "split" }))
    ];

    const confirmedDividends = userDividends.filter(d => d.status === 'confirmed');
    evts.push(...confirmedDividends.map(d => ({ ...d, eventType: "dividend" })));

    // Sort all events by date string to ensure correct order.
    evts.sort((a, b) => DateUtil.toYMD(a.date).localeCompare(DateUtil.toYMD(b.date)));
    
    const firstTx = txs.sort((a,b) => DateUtil.toYMD(a.date).localeCompare(DateUtil.toYMD(b.date)))[0];
    return { evts, firstBuyDate: firstTx ? DateUtil.toDate(firstTx.date) : null };
}

// [CORE FIX] This function now prepares a sorted event list before calling getPortfolioStateOnDate.
async function generatePendingDividends(uid, txs, splits, market) {
    console.log(`[${uid}] 開始掃描並產生待確認的配息紀錄...`);
    const allSymbols = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
    const allGlobalDividends = await d1Client.query('SELECT * FROM dividend_history');
    const existingUserDividends = await d1Client.query('SELECT symbol, date FROM user_dividends WHERE uid = ?', [uid]);
    const existingSet = new Set(existingUserDividends.map(d => `${d.symbol}|${DateUtil.toYMD(d.date)}`));
    const newDividendsToInsert = [];

    // Prepare a sorted list of transaction and split events for accurate state calculation.
    const allSortedEvents = [
        ...txs.map(t => ({ ...t, eventType: "transaction" })),
        ...splits.map(s => ({ ...s, eventType: "split" }))
    ].sort((a, b) => DateUtil.toYMD(a.date).localeCompare(DateUtil.toYMD(b.date)));

    for (const globalDiv of allGlobalDividends) {
        const divDateStr = DateUtil.toYMD(globalDiv.date);
        const sym = globalDiv.symbol.toUpperCase();

        if (!allSymbols.includes(sym) || existingSet.has(`${sym}|${divDateStr}`)) {
            continue;
        }

        const stateOnDate = getPortfolioStateOnDate(allSortedEvents, divDateStr, market);
        const holding = stateOnDate[sym];
        const sharesOnDate = holding ? holding.lots.reduce((sum, lot) => sum + lot.quantity, 0) : 0;

        if (sharesOnDate > 0) {
            console.log(`[${uid}] 發現新的應收配息: ${sharesOnDate} 股的 ${sym} 在 ${divDateStr}`);
            const currency = holding.currency || 'USD';
            const fx = findFxRate(market, currency, DateUtil.toDate(divDateStr));
            const grossAmount = sharesOnDate * globalDiv.dividend;
            const taxRate = isTwStock(sym) ? 0.0 : 0.3;
            const estimatedTax = grossAmount * taxRate;
            const netAmount = grossAmount - estimatedTax;

            newDividendsToInsert.push({
                sql: `INSERT INTO user_dividends (id, uid, symbol, date, quantity, dividend_per_share, gross_amount, net_amount, tax, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [uuidv4(), uid, sym, divDateStr, sharesOnDate, globalDiv.dividend, grossAmount, netAmount, estimatedTax, currency, 'pending']
            });
            existingSet.add(`${sym}|${divDateStr}`);
        }
    }

    if (newDividendsToInsert.length > 0) {
        await d1Client.batch(newDividendsToInsert);
        console.log(`[${uid}] 成功產生了 ${newDividendsToInsert.length} 筆新的待確認配息紀錄。`);
    }
}

// ... (The rest of the file, including performRecalculation and the main handler, remains largely the same but will now use the fixed functions)

async function performRecalculation(uid) {
    console.log(`--- [${uid}] 重新計算程序開始 (v3.1 - 日期修正版) ---`);
    try {
        const [txs, splits, controlsData, userDividends] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ?', [uid]), // No longer need to order here
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid])
        ]);

        if (txs.length === 0) {
            // ... (cleanup logic remains the same)
            return;
        }

        const { evts, firstBuyDate } = prepareEvents(txs, splits, userDividends);
        if (!firstBuyDate) { return; }

        // ... (rest of the recalculation logic is the same)

        await generatePendingDividends(uid, txs, splits, market);

        console.log(`--- [${uid}] 重新計算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 計算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

// ... (The main unifiedPortfolioHandler with all its cases remains the same)