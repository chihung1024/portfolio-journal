/**
 * API Handler for Portfolio Journal
 * 
 * This single file acts as the backend for the application, handling all API requests.
 * It's designed to run on Cloudflare Pages Functions.
 * - Interacts with a Cloudflare D1 database bound as `env.DB`.
 * - Responds to GET/POST requests for transactions and portfolio data.
 * - Includes a one-time database initialization endpoint.
 */

// Main handler for all function requests
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // Use a simple router to handle different API endpoints
    const apiRoute = url.pathname.replace(/^\/api/, '');

    try {
        if (apiRoute.startsWith('/transactions')) {
            if (request.method === 'GET') {
                return await getTransactions(env.DB);
            } else if (request.method === 'POST') {
                const transaction = await request.json();
                return await addTransaction(env.DB, transaction);
            }
        } else if (apiRoute.startsWith('/portfolio')) {
            if (request.method === 'GET') {
                return await getPortfolio(env.DB);
            }
        } else if (apiRoute.startsWith('/initialize-database')) {
            if (request.method === 'POST') {
                return await initializeDatabase(env.DB);
            }
        }

        return new Response(JSON.stringify({ error: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (e) {
        console.error('API Error:', e);
        return new Response(JSON.stringify({ error: e.message || 'An internal error occurred' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

/**
 * Fetches all transactions from the database.
 */
async function getTransactions(db) {
    const { results } = await db.prepare("SELECT * FROM transactions ORDER BY date DESC").all();
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
}

/**
 * Adds a new transaction to the database.
 */
async function addTransaction(db, tx) {
    if (!tx.ticker || !tx.shares || !tx.price || !tx.date) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const stmt = db.prepare('INSERT INTO transactions (ticker, shares, price, date) VALUES (?, ?, ?, ?)');
    await stmt.bind(tx.ticker.toUpperCase(), tx.shares, tx.price, tx.date).run();
    return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Calculates and returns the portfolio summary, including dividend calculations.
 */
async function getPortfolio(db) {
    // Fetch all necessary data in parallel
    const txStmt = db.prepare("SELECT * FROM transactions ORDER BY date ASC");
    const priceStmt = db.prepare("SELECT * FROM prices");
    const dividendStmt = db.prepare("SELECT * FROM dividends ORDER BY exDate ASC");
    const [{ results: transactions }, { results: prices }, { results: dividends }] = await db.batch([txStmt, priceStmt, dividendStmt]);

    const portfolio = {};
    const priceMap = new Map(prices.map(p => [p.ticker, p.price]));

    // Calculate total dividends received for each stock
    const dividendIncome = {};
    for (const dividend of dividends) {
        if (!dividendIncome[dividend.ticker]) {
            dividendIncome[dividend.ticker] = 0;
        }
        // Find the number of shares owned on the dividend ex-date
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

    // Aggregate transactions by ticker
    for (const tx of transactions) {
        if (!portfolio[tx.ticker]) {
            portfolio[tx.ticker] = { totalShares: 0, totalCost: 0 };
        }
        portfolio[tx.ticker].totalShares += tx.shares;
        portfolio[tx.ticker].totalCost += tx.shares * tx.price;
    }

    // Calculate final metrics for each stock
    for (const ticker in portfolio) {
        const stock = portfolio[ticker];
        if (stock.totalShares > 0.00001) { // Use a small epsilon for float comparison
            stock.averageCost = stock.totalCost / stock.totalShares;
            const currentPrice = priceMap.get(ticker) || 0;
            stock.marketValue = stock.totalShares * currentPrice;
            stock.unrealizedPnl = stock.marketValue - stock.totalCost;
            stock.totalDividends = dividendIncome[ticker] || 0;
            stock.totalReturn = stock.unrealizedPnl + stock.totalDividends;
        } else {
            // If shares are sold off, remove from portfolio view
            delete portfolio[ticker];
        }
    }

    return new Response(JSON.stringify(portfolio), { headers: { 'Content-Type': 'application/json' } });
}

/**
 * Initializes the database with tables and sample data.
 * This is an idempotent operation.
 */
async function initializeDatabase(db) {
    const batch = [
        // Create tables if they don't exist
        db.prepare(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, shares REAL NOT NULL, price REAL NOT NULL, date TEXT NOT NULL);`),
        db.prepare(`CREATE TABLE IF NOT EXISTS prices (ticker TEXT PRIMARY KEY, price REAL NOT NULL, last_updated TEXT NOT NULL);`),
        db.prepare(`CREATE TABLE IF NOT EXISTS dividends (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL, exDate TEXT NOT NULL, amount REAL NOT NULL, UNIQUE(ticker, exDate));`),
        
        // Clear existing data to ensure a clean slate for samples
        db.prepare(`DELETE FROM transactions;`),
        db.prepare(`DELETE FROM prices;`),
        db.prepare(`DELETE FROM dividends;`),

        // Insert sample data
        db.prepare(`INSERT INTO transactions (ticker, shares, price, date) VALUES ('AAPL', 10, 150.25, '2023-01-15'), ('GOOGL', 5, 2750.00, '2023-01-20'), ('MSFT', 8, 305.50, '2023-02-01');`),
        db.prepare(`INSERT INTO prices (ticker, price, last_updated) VALUES ('AAPL', 175.50, datetime('now')), ('GOOGL', 2800.00, datetime('now')), ('MSFT', 330.00, datetime('now'));`),
        db.prepare(`INSERT INTO dividends (ticker, exDate, amount) VALUES ('AAPL', '2023-02-10', 0.23), ('MSFT', '2023-02-15', 0.68);`)
    ];

    await db.batch(batch.map(stmt => stmt.bind()));

    return new Response(JSON.stringify({ success: true, message: 'Database initialized.' }), { headers: { 'Content-Type': 'application/json' } });
}
