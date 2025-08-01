/**
 * API Handler for Portfolio Journal (Cloudflare Edition)
 * This backend supports the new TailwindCSS UI.
 */

// Simple router
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');

    // Ensure DB binding exists
    if (!env.DB) {
        return jsonResponse({ error: "Database D1 binding not found. Please check Pages project settings." }, 500);
    }

    try {
        // Route for transactions
        if (path.startsWith('/transactions')) {
            if (request.method === 'GET') return await getTransactions(env.DB);
            if (request.method === 'POST') return await addTransaction(env.DB, await request.json());
            if (request.method === 'DELETE') {
                const id = path.split('/').pop();
                return await deleteTransaction(env.DB, id);
            }
        }
        // Route for portfolio calculation
        if (path.startsWith('/portfolio')) {
            if (request.method === 'GET') return await getPortfolio(env.DB);
        }
        // Route for DB initialization
        if (path.startsWith('/initialize-database')) {
            if (request.method === 'POST') return await initializeDatabase(env.DB);
        }

        return jsonResponse({ error: 'Not Found' }, 404);
    } catch (e) {
        console.error('Request Error:', e);
        return jsonResponse({ error: e.message || 'Internal Server Error' }, 500);
    }
}

// --- Database Functions ---

async function getTransactions(db) {
    const { results } = await db.prepare("SELECT * FROM transactions ORDER BY date DESC").all();
    return jsonResponse(results);
}

async function addTransaction(db, tx) {
    if (!tx.ticker || !tx.shares || !tx.price || !tx.date) {
        return jsonResponse({ error: 'Missing required fields' }, 400);
    }
    await db.prepare('INSERT INTO transactions (ticker, shares, price, date) VALUES (?, ?, ?, ?)')
        .bind(tx.ticker.toUpperCase(), tx.shares, tx.price, tx.date)
        .run();
    return jsonResponse({ success: true }, 201);
}

async function deleteTransaction(db, id) {
    if (!id) return jsonResponse({ error: 'Invalid ID' }, 400);
    await db.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
    return jsonResponse({ success: true });
}

async function getPortfolio(db) {
    const [txData, priceData, dividendData] = await db.batch([
        db.prepare("SELECT * FROM transactions ORDER BY date ASC"),
        db.prepare("SELECT * FROM prices"),
        db.prepare("SELECT * FROM dividends ORDER BY exDate ASC")
    ]);

    const transactions = txData.results;
    const prices = new Map(priceData.results.map(p => [p.ticker, p.price]));
    const dividends = dividendData.results;

    const portfolio = {};

    for (const tx of transactions) {
        if (!portfolio[tx.ticker]) {
            portfolio[tx.ticker] = { totalShares: 0, totalCost: 0, totalDividends: 0 };
        }
        portfolio[tx.ticker].totalShares += tx.shares;
        portfolio[tx.ticker].totalCost += tx.shares * tx.price;
    }

    for (const div of dividends) {
        if (portfolio[div.ticker]) {
            let sharesOnDate = 0;
            for (const tx of transactions) {
                if (tx.ticker === div.ticker && new Date(tx.date) < new Date(div.exDate)) {
                    sharesOnDate += tx.shares;
                }
            }
            if (sharesOnDate > 0) {
                portfolio[div.ticker].totalDividends += sharesOnDate * div.amount;
            }
        }
    }

    for (const ticker in portfolio) {
        const stock = portfolio[ticker];
        if (stock.totalShares < 1e-6) {
            delete portfolio[ticker];
            continue;
        }
        stock.averageCost = stock.totalCost / stock.totalShares;
        stock.marketValue = stock.totalShares * (prices.get(ticker) || 0);
        stock.unrealizedPnl = stock.marketValue - stock.totalCost;
        stock.totalReturn = stock.unrealizedPnl + stock.totalDividends;
    }

    return jsonResponse(portfolio);
}

async function initializeDatabase(db) {
    try {
        await db.batch([
            db.prepare(`DROP TABLE IF EXISTS transactions;`),
            db.prepare(`DROP TABLE IF EXISTS prices;`),
            db.prepare(`DROP TABLE IF EXISTS dividends;`),
            db.prepare(`CREATE TABLE transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, shares REAL NOT NULL, price REAL NOT NULL, date TEXT NOT NULL);`),
            db.prepare(`CREATE TABLE prices (ticker TEXT PRIMARY KEY, price REAL NOT NULL, last_updated TEXT NOT NULL);`),
            db.prepare(`CREATE TABLE dividends (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, exDate TEXT NOT NULL, amount REAL NOT NULL, UNIQUE(ticker, exDate));`),
            db.prepare(`INSERT INTO transactions (ticker, shares, price, date) VALUES ('AAPL', 10, 150.25, '2023-01-15'), ('TSLA', 5, 250.00, '2023-03-10');`),
            db.prepare(`INSERT INTO prices (ticker, price, last_updated) VALUES ('AAPL', 175.00, '2023-10-27'), ('TSLA', 220.00, '2023-10-27');`),
            db.prepare(`INSERT INTO dividends (ticker, exDate, amount) VALUES ('AAPL', '2023-08-11', 0.24);`)
        ]);
        return jsonResponse({ success: true, message: 'Database initialized.' });
    } catch (e) {
        console.error("D1 Init Error:", e);
        return jsonResponse({ error: `Database command failed: ${e.cause ? e.cause.message : e.message}` }, 500);
    }
}

// Helper for consistent JSON responses
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: { 'Content-Type': 'application/json' },
    });
}
