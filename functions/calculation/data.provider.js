// =========================================================================================
// == 市場數據提供者 (data.provider.js)
// == 職責：處理所有從外部 API 或資料庫獲取、儲存及準備市場數據的相關邏輯。
// =========================================================================================

const yahooFinance = require("yahoo-finance2").default;
const { d1Client } = require('../d1.client');

const currencyToFx = { USD: "TWD=X", HKD: "HKDTWD=X", JPY: "JPYTWD=X" };

/**
 * 根據指定日期範圍，從 Yahoo Finance 抓取歷史數據並儲存至 D1
 */
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
        console.error(`Error fetching market data for ${symbol}:`, e);
        return null;
    }
}

/**
 * 確保單一金融商品的歷史數據至少涵蓋到指定的開始日期
 */
async function ensureDataCoverage(symbol, requiredStartDate) {
    if (!symbol || !requiredStartDate) return;
    const coverageData = await d1Client.query('SELECT earliest_date FROM market_data_coverage WHERE symbol = ?', [symbol]);
    const today = new Date().toISOString().split('T')[0];

    if (coverageData.length === 0) {
        // 全新商品，直接抓取完整歷史數據
        const fetchedData = await fetchAndSaveMarketDataRange(symbol, requiredStartDate, today);
        if (fetchedData && fetchedData.length > 0) {
            const actualEarliestDate = fetchedData[0].date.toISOString().split('T')[0];
            await d1Client.query('INSERT INTO market_data_coverage (symbol, earliest_date, last_updated) VALUES (?, ?, ?)', [symbol, actualEarliestDate, today]);
        }
        return;
    }

    const currentEarliestDate = coverageData[0].earliest_date;
    if (requiredStartDate < currentEarliestDate) {
        // 需要的日期比現有的還早，必須刪除舊的並抓取更完整的數據
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

/**
 * 確保所有需要的金融商品數據都是最新的（更新到昨天）
 */
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

/**
 * 從 D1 資料庫中獲取所有計算需要的市場數據（股價、股利、匯率）
 */
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

    const marketData = allSymbols.reduce((acc, symbol) => ({ ...acc, [symbol]: { prices: {}, dividends: {} } }), {});

    stockPricesFlat.forEach(row => { marketData[row.symbol].prices[row.date.split('T')[0]] = row.price; });
    stockDividendsFlat.forEach(row => { marketData[row.symbol].dividends[row.date.split('T')[0]] = row.dividend; });
    fxRatesFlat.forEach(row => { marketData[row.symbol].prices[row.date.split('T')[0]] = row.price; });
    
    // 為了語意清晰，為匯率物件增加一個 'rates' 的別名
    requiredFxSymbols.forEach(fxSymbol => {
        if (marketData[fxSymbol]) {
            marketData[fxSymbol].rates = marketData[fxSymbol].prices;
        }
    });

    return marketData;
}

module.exports = {
    fetchAndSaveMarketDataRange,
    ensureDataCoverage,
    ensureDataFreshness,
    getMarketDataFromDb
};
