// =========================================================================================
// == 市場數據提供者 (data.provider.js) (v2.0 - 支援隨需獲取 Fetch-on-Demand)
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
        console.log(`[Data Provider] Fetching ${symbol} from ${startDate} to ${endDate}...`);
        const hist = await yahooFinance.historical(symbol, { period1: startDate, period2: endDate, interval: '1d' });
        if (!hist || hist.length === 0) {
            console.warn(`[Data Provider] No data returned from Yahoo Finance for ${symbol}.`);
            return [];
        }

        const dbOps = [];
        const tableName = symbol.includes("=") ? "exchange_rates" : "price_history";
        
        for (const item of hist) {
            const itemDate = item.date.toISOString().split('T')[0];
            // 確保 close 價格是有效的數字
            if (item.close !== null && !isNaN(item.close)) {
                dbOps.push({ 
                    sql: `INSERT OR IGNORE INTO ${tableName} (symbol, date, price) VALUES (?, ?, ?)`, 
                    params: [symbol, itemDate, item.close] 
                });
            }
            // 處理股利數據
            if (!symbol.includes("=") && item.dividends && item.dividends > 0) {
                dbOps.push({ 
                    sql: `INSERT OR IGNORE INTO dividend_history (symbol, date, dividend) VALUES (?, ?, ?)`, 
                    params: [symbol, itemDate, item.dividends] 
                });
            }
        }
        
        if (dbOps.length > 0) {
            await d1Client.batch(dbOps);
            console.log(`[Data Provider] Successfully saved ${dbOps.length} DB operations for ${symbol}.`);
        }
        return hist;
    } catch (e) {
        // yfinance 對於找不到的 ticker 會拋出錯誤，這是預期行為，作警告處理即可
        if (e.message.includes('No data found')) {
            console.warn(`[Data Provider] Yahoo Finance reported no data found for symbol: ${symbol}.`);
        } else {
            console.error(`[Data Provider] Error fetching market data for ${symbol}:`, e.message);
        }
        return null;
    }
}

/**
 * [核心升級] 確保單一金融商品的歷史數據存在且完整。
 * 如果不存在，則從 requiredStartDate 開始抓取；如果已存在但數據不夠早，則會補充抓取。
 */
async function ensureDataCoverage(symbol, requiredStartDate) {
    if (!symbol || !requiredStartDate) return;
    
    const coverageData = await d1Client.query('SELECT earliest_date FROM market_data_coverage WHERE symbol = ?', [symbol]);
    const today = new Date().toISOString().split('T')[0];

    if (coverageData.length === 0) {
        // 全新商品，直接抓取完整歷史數據
        console.log(`[Data Provider] ${symbol} is a new symbol. Fetching full history from ${requiredStartDate}...`);
        const fetchedData = await fetchAndSaveMarketDataRange(symbol, requiredStartDate, today);
        if (fetchedData && fetchedData.length > 0) {
            // 使用 yfinance 回傳的第一筆數據的日期作為實際的最早日期
            const actualEarliestDate = fetchedData[0].date.toISOString().split('T')[0];
            await d1Client.query('INSERT OR REPLACE INTO market_data_coverage (symbol, earliest_date, last_updated) VALUES (?, ?, ?)', [symbol, actualEarliestDate, today]);
        }
        return;
    }

    const currentEarliestDate = coverageData[0].earliest_date.split('T')[0];
    if (requiredStartDate < currentEarliestDate) {
        // 需要的日期比現有的還早，必須補充抓取更早的數據
        console.log(`[Data Provider] ${symbol} requires older data (needs ${requiredStartDate}, has ${currentEarliestDate}). Fetching missing range...`);
        
        const dayBeforeCurrent = new Date(currentEarliestDate);
        dayBeforeCurrent.setDate(dayBeforeCurrent.getDate() - 1);
        const fetchEndDate = dayBeforeCurrent.toISOString().split('T')[0];
        
        const fetchedData = await fetchAndSaveMarketDataRange(symbol, requiredStartDate, fetchEndDate);
        if (fetchedData && fetchedData.length > 0) {
            const actualEarliestDate = fetchedData[0].date.toISOString().split('T')[0];
            // 更新 coverage 表中的最早日期紀錄
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
    // 我們目標是獲取到昨天的收盤價
    targetDate.setDate(today.getDate() - 1); 
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const fetchPromises = symbols.map(async (symbol) => {
        const coverage = await d1Client.query('SELECT last_updated FROM market_data_coverage WHERE symbol = ?', [symbol]);
        const lastUpdatedStr = coverage?.[0]?.last_updated?.split('T')[0];

        // 如果從未更新過，或最後更新日期在昨天之前，則需要更新
        if (!lastUpdatedStr || lastUpdatedStr < targetDateStr) {
            const startDate = new Date(lastUpdatedStr || '2000-01-01');
            startDate.setDate(startDate.getDate() + 1);
            const startDateStr = startDate.toISOString().split('T')[0];
            
            console.log(`[Data Provider] ${symbol} data is not fresh. Fetching increment from ${startDateStr}...`);
            await fetchAndSaveMarketDataRange(symbol, startDateStr, today.toISOString().split('T')[0]);
            // 更新覆蓋範圍表的最後更新日期
            await d1Client.query('UPDATE market_data_coverage SET last_updated = ? WHERE symbol = ?', [today.toISOString().split('T')[0], symbol]);
        }
    });

    await Promise.all(fetchPromises);
}


/**
 * 【核心升級】確保所有需要的金融商品數據都存在於資料庫中
 * @param {Array} txs - 交易紀錄 (可以是真實的或模擬的)
 * @param {string} benchmarkSymbol - 比較基準的股票代碼
 */
async function ensureAllSymbolsData(txs, benchmarkSymbol) {
    if ((!txs || txs.length === 0) && !benchmarkSymbol) return;

    const allSymbols = new Set(txs.map(t => t.symbol.toUpperCase()));
    if (benchmarkSymbol) {
        allSymbols.add(benchmarkSymbol.toUpperCase());
    }

    const requiredFxSymbols = new Set();
    txs.forEach(t => {
        if (t.currency && currencyToFx[t.currency]) {
            requiredFxSymbols.add(currencyToFx[t.currency]);
        }
    });
    // benchmark 也可能不是 TWD 計價，但為簡化，我們假設 benchmark 是 USD 或 TWD
    if (benchmarkSymbol && !benchmarkSymbol.toUpperCase().endsWith('.TW')) {
        requiredFxSymbols.add(currencyToFx['USD']);
    }

    const allRequiredSymbols = [...new Set([...allSymbols, ...requiredFxSymbols])];

    // 找到全局最早的事件日期
    const globalFirstTxDate = txs.reduce((earliest, tx) => {
        const txDate = new Date(tx.date);
        return txDate < earliest ? txDate : earliest;
    }, new Date());
    const globalFirstTxDateStr = globalFirstTxDate.toISOString().split('T')[0];

    // 並行檢查並補充所有需要的數據
    const coveragePromises = allRequiredSymbols.map(symbol => {
        let requiredStartDate = globalFirstTxDateStr;

        // 如果不是匯率或 benchmark，則使用該個股自己的最早交易日期
        if (!requiredFxSymbols.has(symbol) && symbol !== benchmarkSymbol.toUpperCase()) {
             const symbolTxs = txs.filter(t => t.symbol.toUpperCase() === symbol);
             if (symbolTxs.length > 0) {
                 const symbolFirstDate = symbolTxs.reduce((earliest, tx) => {
                     const txDate = new Date(tx.date);
                     return txDate < earliest ? txDate : earliest;
                 }, new Date());
                 requiredStartDate = symbolFirstDate.toISOString().split('T')[0];
             }
        }
        return ensureDataCoverage(symbol, requiredStartDate);
    });

    await Promise.all(coveragePromises);
    
    // 在確保覆蓋範圍後，再統一更新到最新
    await ensureDataFreshness(allRequiredSymbols);
}


/**
 * 從 D1 資料庫中獲取所有計算需要的市場數據（股價、股利、匯率）
 */
async function getMarketDataFromDb(txs, benchmarkSymbol) {
    const symbolsInPortfolio = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
    const currencies = [...new Set(txs.map(t => t.currency))].filter(c => c !== "TWD");
    const requiredFxSymbols = currencies.map(c => currencyToFx[c]).filter(Boolean);
    
    let allRequiredSymbolsForFetch = [...symbolsInPortfolio, ...requiredFxSymbols];
    if (benchmarkSymbol) {
        allRequiredSymbolsForFetch.push(benchmarkSymbol.toUpperCase());
    }
    allRequiredSymbolsForFetch = [...new Set(allRequiredSymbolsForFetch)];


    if (allRequiredSymbolsForFetch.length === 0) return {};
    
    const placeholders = allRequiredSymbolsForFetch.map(() => '?').join(',');

    const [stockPricesFlat, stockDividendsFlat, fxRatesFlat] = await Promise.all([
        d1Client.query(`SELECT symbol, date, price FROM price_history WHERE symbol IN (${placeholders})`, allRequiredSymbolsForFetch),
        d1Client.query(`SELECT symbol, date, dividend FROM dividend_history WHERE symbol IN (${placeholders})`, allRequiredSymbolsForFetch),
        d1Client.query(`SELECT symbol, date, price FROM exchange_rates WHERE symbol IN (${placeholders})`, allRequiredSymbolsForFetch)
    ]);

    const marketData = allRequiredSymbolsForFetch.reduce((acc, symbol) => ({ ...acc, [symbol]: { prices: {}, dividends: {}, rates: {} } }), {});

    stockPricesFlat.forEach(row => { marketData[row.symbol.toUpperCase()].prices[row.date.split('T')[0]] = row.price; });
    stockDividendsFlat.forEach(row => { marketData[row.symbol.toUpperCase()].dividends[row.date.split('T')[0]] = row.dividend; });
    fxRatesFlat.forEach(row => { 
        marketData[row.symbol.toUpperCase()].rates[row.date.split('T')[0]] = row.price; 
        marketData[row.symbol.toUpperCase()].prices[row.date.split('T')[0]] = row.price; // 也加入 prices，方便匯率本身也能被當成標的分析
    });
    
    return marketData;
}


module.exports = {
    fetchAndSaveMarketDataRange,
    ensureDataCoverage,
    ensureDataFreshness,
    getMarketDataFromDb,
    ensureAllSymbolsData,
};
