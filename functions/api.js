/**
 * API Handler for Portfolio Journal on Cloudflare Pages Functions
 * (Version with improved error handling)
 */

// Main request handler
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const apiRoute = url.pathname.replace(/^\/api/, '');

    // Crucial check: Ensure the D1 binding exists.
    if (!env.DB) {
        return new Response(JSON.stringify({ error: "Database (D1) binding not found. Please check your Pages project settings." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        if (apiRoute.startsWith('/transactions')) {
            if (request.method === 'GET') return await getTransactions(env.DB);
            if (request.method === 'POST') return await addTransaction(env.DB, await request.json());
        }
        if (apiRoute.startsWith('/portfolio')) {
            if (request.method === 'GET') return await getPortfolio(env.DB);
        }
        if (apiRoute.startsWith('/initialize-database')) {
            if (request.method === 'POST') return await initializeDatabase(env.DB);
        }
        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        console.error('API Error:', e);
        return new Response(JSON.stringify({ error: e.message || 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// ... (getTransactions, addTransaction, getPortfolio functions remain the same as the last version) ...

// Fetches all transactions
async function getTransactions(db) {
    const { results } = await db.prepare("SELECT * FROM transactions ORDER BY date DESC").all();
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
}

// Adds a new transaction
async function addTransaction(db, tx) {
    if (!tx.ticker || !tx.shares || !tx.price || !tx.date) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }
    await db.prepare('INSERT INTO transactions (ticker, shares, price, date) VALUES (?, ?, ?, ?)')
            .bind(tx.ticker.toUpperCase(), tx.shares, tx.price, tx.date)
            .run();
    return new Response(JSON.stringify({ success: true }), { status: 201 });
}

// Calculates and returns the portfolio summary
async function getPortfolio(db) {
    const txStmt = db.prepare("SELECT * FROM transactions ORDER BY date ASC");
    const priceStmt = db.prepare("SELECT * FROM prices");
    const dividendStmt = db.prepare("SELECT * FROM dividends ORDER BY exDate ASC");
    const [{ results: transactions }, { results: prices }, { results: dividends }] = await db.batch([txStmt, priceStmt, dividendStmt]);

    const portfolio = {};
    const priceMap = new Map(prices.map(p => [p.ticker, p.price]));
    const dividendIncome = {};

    for (const dividend of dividends) {
        dividendIncome[dividend.ticker] = (dividendIncome[dividend.ticker] || 0);
        let sharesOnDate = 0;
        for (const tx of transactions) {
            if (tx.ticker === dividend.ticker && new Date(tx.date) < new Date(dividend.exDate)) {
                sharesOnDate += tx.shares;
            }
        }
        if (sharesOnDate > 0) {
            dividendIncome[dividend.ticker] += sharesOnDate * dividend.amount;
        }
    }

    for (const tx of transactions) {
        if (!portfolio[tx.ticker]) {
            portfolio[tx.ticker] = { totalShares: 0, totalCost: 0 };
        }
        portfolio[tx.ticker].totalShares += tx.shares;
        portfolio[tx.ticker].totalCost += tx.shares * tx.price;
    }

    for (const ticker in portfolio) {
        const stock = portfolio[ticker];
        if (stock.totalShares > 1e-6) {
            stock.averageCost = stock.totalCost / stock.totalShares;
            stock.marketValue = stock.totalShares * (priceMap.get(ticker) || 0);
            stock.unrealizedPnl = stock.marketValue - stock.totalCost;
            stock.totalDividends = dividendIncome[ticker] || 0;
            stock.totalReturn = stock.unrealizedPnl + stock.totalDividends;
        } else {
            delete portfolio[ticker];
        }
    }

    return new Response(JSON.stringify(portfolio), { headers: { 'Content-Type': 'application/json' } });
}


// Initializes the database with tables and sample data
async function initializeDatabase(db) {
    try {
        await db.batch([
            db.prepare(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, shares REAL NOT NULL, price REAL NOT NULL, date TEXT NOT NULL);`),
            db.prepare(`CREATE TABLE IF NOT EXISTS prices (ticker TEXT PRIMARY KEY, price REAL NOT NULL, last_updated TEXT NOT NULL);`),
            db.prepare(`CREATE TABLE IF NOT EXISTS dividends (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, exDate TEXT NOT NULL, amount REAL NOT NULL, UNIQUE(ticker, exDate));`),
            db.prepare(`DELETE FROM transactions;`),
            db.prepare(`DELETE FROM prices;`),
            db.prepare(`DELETE FROM dividends;`),
            db.prepare(`INSERT INTO transactions (ticker, shares, price, date) VALUES ('AAPL', 10, 150.25, '2023-01-15'), ('GOOGL', 5, 2750.00, '2023-01-20'), ('MSFT', 8, 305.50, '2023-02-01');`),
            db.prepare(`INSERT INTO prices (ticker, price, last_updated) VALUES ('AAPL', 175.50, '2023-10-27'), ('GOOGL', 2800.00, '2023-10-27'), ('MSFT', 330.00, '2023-10-27');`),
            db.prepare(`INSERT INTO dividends (ticker, exDate, amount) VALUES ('AAPL', '2023-02-10', 0.23), ('MSFT', '2023-02-15', 0.68);`)
        ]);
        return new Response(JSON.stringify({ success: true, message: 'Database initialized.' }), { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        console.error("D1 Batch Error in initializeDatabase:", e);
        return new Response(JSON.stringify({ error: `Database command failed: ${e.message}` }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}