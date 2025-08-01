/**
 * Cloudflare Pages API for Portfolio Journal
 * This backend mirrors the logic from the original Firebase project.
 */

// --- Main API Router ---
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');

    if (!env.DB) {
        return jsonResponse({ error: "Database (D1) binding not found. Please check Pages project settings." }, 500);
    }

    try {
        if (path.startsWith('/transactions')) {
            if (request.method === 'GET') return await getTransactions(env.DB);
            if (request.method === 'POST') return await addTransaction(env.DB, await request.json());
            if (request.method === 'DELETE') {
                const id = path.split('/').pop();
                return await deleteTransaction(env.DB, id);
            }
        }
        if (path.startsWith('/portfolio')) {
            if (request.method === 'GET') return await getPortfolio(env.DB);
        }
        if (path.startsWith('/initialize-database')) {
            if (request.method === 'POST') return await initializeDatabase(env.DB);
        }
        return jsonResponse({ error: 'Not Found' }, 404);
    } catch (e) {
        console.error('Request Error:', e);
        return jsonResponse({ error: e.message || 'Internal Server Error' }, 500);
    }
}

// --- API Endpoint Functions ---

async function getTransactions(db) {
    const { results } = await db.prepare("SELECT * FROM transactions ORDER BY date DESC").all();
    return jsonResponse(results || []);
}

async function addTransaction(db, tx) {
    if (!tx.symbol || !tx.type || isNaN(tx.quantity) || isNaN(tx.price) || !tx.date || !tx.currency) {
        return jsonResponse({ error: 'Missing or invalid required fields' }, 400);
    }
    await db.prepare('INSERT INTO transactions (symbol, type, quantity, price, date, currency) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(tx.symbol.toUpperCase(), tx.type, tx.quantity, tx.price, tx.date, tx.currency)
        .run();
    return jsonResponse({ success: true }, 201);
}

async function deleteTransaction(db, id) {
    if (!id || isNaN(parseInt(id))) return jsonResponse({ error: 'Invalid ID' }, 400);
    await db.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
    return jsonResponse({ success: true });
}

async function initializeDatabase(db) {
    const batch = [
        db.prepare(`DROP TABLE IF EXISTS transactions;`),
        db.prepare(`DROP TABLE IF EXISTS prices;`),
        db.prepare(`DROP TABLE IF EXISTS dividends;`),
        db.prepare(`CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, date TEXT NOT NULL, currency TEXT NOT NULL);`),
        db.prepare(`CREATE TABLE prices (ticker TEXT PRIMARY KEY, price REAL NOT NULL, last_updated TEXT NOT NULL);`),
        db.prepare(`CREATE TABLE dividends (ticker TEXT PRIMARY KEY, exDate TEXT NOT NULL, amount REAL NOT NULL, UNIQUE(ticker, exDate));`),
        db.prepare(`INSERT INTO transactions (symbol, type, quantity, price, date, currency) VALUES ('AAPL', 'buy', 10, 150.25, '2023-01-15', 'USD'), ('TSLA', 'buy', 5, 250.00, '2023-03-10', 'USD'), ('2330.TW', 'buy', 1000, 500, '2023-05-20', 'TWD');`),
        db.prepare(`INSERT INTO prices (ticker, price, last_updated) VALUES ('AAPL', 175.00, '2023-10-27'), ('TSLA', 220.00, '2023-10-27'), ('2330.TW', 550, '2023-10-27'), ('TWD=X', 32.5, '2023-10-27');`),
        db.prepare(`INSERT INTO dividends (ticker, exDate, amount) VALUES ('AAPL', '2023-08-11', 0.24);`)
    ];
    await db.batch(batch);
    return jsonResponse({ success: true, message: 'Database initialized.' });
}

async function getPortfolio(db) {
    const [txData, priceData, dividendData] = await db.batch([
        db.prepare("SELECT * FROM transactions ORDER BY date ASC"),
        db.prepare("SELECT * FROM prices"),
        db.prepare("SELECT * FROM dividends")
    ]);

    const market = {
        prices: new Map(priceData.results.map(p => [p.ticker, p.price])),
        dividends: dividendData.results || [],
        fx: new Map(priceData.results.filter(p => p.ticker.endsWith('=X')).map(p => [p.ticker, p.price]))
    };

    const portfolio = calculateCoreMetrics(txData.results || [], market);
    return jsonResponse(portfolio);
}

// --- Core Calculation Logic (adapted from Firebase project) ---

function calculateCoreMetrics(transactions, market) {
    const holdings = {};
    let totalRealizedPL = 0;

    const findFxRate = (currency, date) => {
        if (currency === 'TWD') return 1;
        // In a real scenario, you would look up historical rates. Here we use the latest for simplicity.
        return market.fx.get('TWD=X') || 32.0;
    };

    for (const tx of transactions) {
        const sym = tx.symbol.toUpperCase();
        if (!holdings[sym]) {
            holdings[sym] = { symbol: sym, currency: tx.currency, lots: [], realizedPL: 0 };
        }

        const fxRate = findFxRate(tx.currency, tx.date);
        const costTWD = tx.price * tx.quantity * (tx.currency === 'TWD' ? 1 : fxRate);

        if (tx.type === 'buy') {
            holdings[sym].lots.push({ quantity: tx.quantity, priceTWD: costTWD / tx.quantity, priceOriginal: tx.price });
        } else { // sell
            let sellQty = tx.quantity;
            const saleProceedsTWD = costTWD;
            let costOfGoodsSoldTWD = 0;

            while (sellQty > 0 && holdings[sym].lots.length > 0) {
                const lot = holdings[sym].lots[0];
                const qtyToSell = Math.min(sellQty, lot.quantity);
                costOfGoodsSoldTWD += qtyToSell * lot.priceTWD;
                lot.quantity -= qtyToSell;
                if (lot.quantity < 1e-9) {
                    holdings[sym].lots.shift();
                }
                sellQty -= qtyToSell;
            }
            const realized = saleProceedsTWD - costOfGoodsSoldTWD;
            totalRealizedPL += realized;
            holdings[sym].realizedPL += realized;
        }
    }

    // Calculate current holdings stats
    const finalHoldings = {};
    let totalMarketValueTWD = 0;
    let totalUnrealizedPLTWD = 0;
    let totalInvestedCostTWD = 0;

    for (const sym in holdings) {
        const h = holdings[sym];
        const totalShares = h.lots.reduce((sum, lot) => sum + lot.quantity, 0);

        if (totalShares < 1e-9) continue; // Skip if fully sold

        const totalCostTWD = h.lots.reduce((sum, lot) => sum + lot.quantity * lot.priceTWD, 0);
        const avgCostOriginal = h.lots.reduce((sum, lot) => sum + lot.quantity * lot.priceOriginal, 0) / totalShares;
        
        const currentPrice = market.prices.get(sym) || 0;
        const fxRate = findFxRate(h.currency, new Date());
        const marketValueTWD = totalShares * currentPrice * (h.currency === 'TWD' ? 1 : fxRate);
        const unrealizedPLTWD = marketValueTWD - totalCostTWD;

        finalHoldings[sym] = {
            symbol: sym,
            quantity: totalShares,
            currency: h.currency,
            avgCostOriginal: avgCostOriginal,
            totalCostTWD: totalCostTWD,
            marketValueTWD: marketValueTWD,
            unrealizedPLTWD: unrealizedPLTWD,
            returnRate: totalCostTWD > 0 ? (unrealizedPLTWD / totalCostTWD) * 100 : 0,
        };
        totalMarketValueTWD += marketValueTWD;
        totalUnrealizedPLTWD += unrealizedPLTWD;
        totalInvestedCostTWD += totalCostTWD;
    }

    const overallReturnRate = totalInvestedCostTWD > 0 ? ((totalUnrealizedPLTWD + totalRealizedPL) / totalInvestedCostTWD) * 100 : 0;

    return {
        holdings: finalHoldings,
        totalMarketValueTWD,
        totalUnrealizedPLTWD,
        totalRealizedPL,
        overallReturnRate
    };
}

// --- Helper Functions ---
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status: status,
        headers: { 'Content-Type': 'application/json' },
    });
}
