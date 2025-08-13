// =========================================================================================
// == 檔案：functions/performRecalculation.js (最終修正版 - 穩健快照生成策略 - 完整全文)
// =========================================================================================

const { d1Client } = require('../d1.client');
const dataProvider = require('./calculation/data.provider');
const { toDate, isTwStock } = require('./calculation/helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./calculation/state.calculator');
const metrics = require('./calculation/metrics.calculator');

/**
 * @async
 * @function maintainSnapshots
 * @description 維護使用者的快照，確保最新快照存在並回補歷史週六快照。
 * @param {string} uid - 使用者ID。
 * @param {object} newFullHistory - 計算出的完整每日資產歷史。
 * @param {Array} evts - 所有的交易事件。
 * @param {object} market - 市場數據物件。
 * @param {boolean} forceCreateLatest - 是否強制建立最新日期的快照。
 */
async function maintainSnapshots(uid, newFullHistory, evts, market, forceCreateLatest) {
    console.log(`[${uid}] 開始維護快照... 強制建立最新快照: ${forceCreateLatest}`);
    if (Object.keys(newFullHistory).length === 0) {
        console.log(`[${uid}] 沒有歷史數據，跳過快照維護。`);
        return;
    }

    const snapshotOps = [];
    const existingSnapshotsResult = await d1Client.query('SELECT date FROM portfolio_snapshots WHERE uid = ?', [uid]);
    const existingSnapshotDates = new Set(existingSnapshotsResult.map(r => r.date.split('T')[0]));
    const sortedHistoryDates = Object.keys(newFullHistory).sort();
    
    // 策略一：確保「最新一天」的快照永遠存在
    const latestDateStr = sortedHistoryDates[sortedHistoryDates.length - 1];
    if (latestDateStr && (forceCreateLatest || !existingSnapshotDates.has(latestDateStr))) {
        const currentDate = new Date(latestDateStr);
        const finalState = getPortfolioStateOnDate(evts, currentDate, market);
        const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
        
        snapshotOps.push({
            sql: `INSERT OR REPLACE INTO portfolio_snapshots (uid, date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?)`,
            params: [uid, latestDateStr, newFullHistory[latestDateStr], totalCost]
        });
        existingSnapshotDates.add(latestDateStr);
    }

    // 策略二：回補歷史上遺失的「週六」快照
    for (const dateStr of sortedHistoryDates) {
        const currentDate = new Date(dateStr);
        if (currentDate.getUTCDay() === 6) { // 6 代表週六
            if (!existingSnapshotDates.has(dateStr)) {
                const finalState = getPortfolioStateOnDate(evts, currentDate, market);
                const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
                
                snapshotOps.push({
                    sql: `INSERT INTO portfolio_snapshots (uid, date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?)`,
                    params: [uid, dateStr, newFullHistory[dateStr], totalCost]
                });
            }
        }
    }

    if (snapshotOps.length > 0) {
        await d1Client.batch(snapshotOps);
        console.log(`[${uid}] 成功建立或更新了 ${snapshotOps.length} 筆快照。`);
    } else {
        console.log(`[${uid}] 快照鏈完整，無需操作。`);
    }
}

/**
 * @async
 * @function calculateAndCachePendingDividends
 * @description 計算並快取使用者待確認的股息。
 * @param {string} uid - 使用者ID。
 * @param {Array} txs - 使用者的所有交易紀錄。
 * @param {Array} userDividends - 使用者已確認的股息紀錄。
 */
async function calculateAndCachePendingDividends(uid, txs, userDividends) {
    console.log(`[${uid}] 開始計算並快取待確認股息...`);
    await d1Client.batch([{ sql: 'DELETE FROM user_pending_dividends WHERE uid = ?', params: [uid] }]);
    if (!txs || txs.length === 0) {
        console.log(`[${uid}] 使用者無交易紀錄，無需快取股息。`);
        return;
    }
    const allMarketDividends = await d1Client.query('SELECT * FROM dividend_history ORDER BY date ASC');
    if (!allMarketDividends || allMarketDividends.length === 0) {
        console.log(`[${uid}] 無市場股息資料，無需快取。`);
        return;
    }
    const confirmedKeys = new Set(userDividends.map(d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`));
    const holdings = {};
    let txIndex = 0;
    const pendingDividends = [];
    const uniqueSymbolsInTxs = [...new Set(txs.map(t => t.symbol.toUpperCase()))];

    allMarketDividends.forEach(histDiv => {
        const divSymbol = histDiv.symbol.toUpperCase();
        if (!uniqueSymbolsInTxs.includes(divSymbol)) return;
        const exDateStr = histDiv.date.split('T')[0];
        if (confirmedKeys.has(`${divSymbol}_${exDateStr}`)) return;
        const exDateMinusOne = new Date(exDateStr);
        exDateMinusOne.setDate(exDateMinusOne.getDate() - 1);
        while (txIndex < txs.length && new Date(txs[txIndex].date) <= exDateMinusOne) {
            const tx = txs[txIndex];
            holdings[tx.symbol.toUpperCase()] = (holdings[tx.symbol.toUpperCase()] || 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity);
            txIndex++;
        }
        const quantity = holdings[divSymbol] || 0;
        if (quantity > 0) {
            const currency = txs.find(t => t.symbol.toUpperCase() === divSymbol)?.currency || (isTwStock(divSymbol) ? 'TWD' : 'USD');
            pendingDividends.push({
                symbol: divSymbol, ex_dividend_date: exDateStr, amount_per_share: histDiv.dividend,
                quantity_at_ex_date: quantity, currency: currency
            });
        }
    });

    if (pendingDividends.length > 0) {
        const dbOps = pendingDividends.map(p => ({
            sql: `INSERT INTO user_pending_dividends (uid, symbol, ex_dividend_date, amount_per_share, quantity_at_ex_date, currency) VALUES (?, ?, ?, ?, ?, ?)`,
            params: [uid, p.symbol, p.ex_dividend_date, p.amount_per_share, p.quantity_at_ex_date, p.currency]
        }));
        await d1Client.batch(dbOps);
    }
    console.log(`[${uid}] 成功快取 ${pendingDividends.length} 筆待確認股息。`);
}

/**
 * @async
 * @function performRecalculation
 * @description 主計算函式，執行完整的重算、指標分析與快照維護。
 * @param {string} uid - 使用者ID。
 * @param {string|null} modifiedTxDate - 修改的交易日期，用於決定快照回滾點。
 * @param {boolean} createSnapshot - 是否強制為最新一天建立快照。
 */
async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    console.log(`--- [${uid}] 同步重算程序開始 (含穩健快照維護) ---`);
    try {
        const [txs, splits, controlsData, userDividends, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT history FROM portfolio_summary WHERE uid = ?', [uid]),
        ]);

        await calculateAndCachePendingDividends(uid, txs, userDividends);

        if (txs.length === 0) {
            await d1Client.batch([
                { sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM user_dividends WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_snapshots WHERE uid = ?', params: [uid] }
            ]);
            return;
        }

        const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';
        const market = await dataProvider.getMarketDataFromDb(txs, benchmarkSymbol); 
        const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);
        if (!firstBuyDate) { return; }

        let calculationStartDate = firstBuyDate;
        let oldHistory = {};

        const LATEST_SNAPSHOT_SQL = modifiedTxDate
            ? `SELECT * FROM portfolio_snapshots WHERE uid = ? AND date < ? ORDER BY date DESC LIMIT 1`
            : `SELECT * FROM portfolio_snapshots WHERE uid = ? ORDER BY date DESC LIMIT 1`;
        const params = modifiedTxDate ? [uid, modifiedTxDate] : [uid];
        const latestValidSnapshotResult = await d1Client.query(LATEST_SNAPSHOT_SQL, params);
        const baseSnapshot = latestValidSnapshotResult[0];

        if (baseSnapshot) {
            console.log(`[${uid}] 找到基準快照: ${baseSnapshot.date}`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND date > ?', [uid, baseSnapshot.date]);
            const snapshotDate = toDate(baseSnapshot.date);
            if (summaryResult[0] && summaryResult[0].history) {
                oldHistory = JSON.parse(summaryResult[0].history);
                Object.keys(oldHistory).forEach(date => { if (toDate(date) > snapshotDate) delete oldHistory[date]; });
            }
            const nextDay = new Date(snapshotDate); nextDay.setDate(nextDay.getDate() + 1);
            calculationStartDate = nextDay;
        } else {
            console.log(`[${uid}] 找不到有效快照，將執行完整計算並清理所有舊快照。`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ?', [uid]);
        }
        
        const partialHistory = {};
        let curDate = new Date(calculationStartDate);
        const today = new Date(); today.setUTCHours(0, 0, 0, 0);
        while (curDate <= today) {
            const dateStr = curDate.toISOString().split('T')[0];
            partialHistory[dateStr] = dailyValue(getPortfolioStateOnDate(evts, curDate, market), market, curDate, evts);
            curDate.setDate(curDate.getDate() + 1);
        }
        const newFullHistory = { ...oldHistory, ...partialHistory };

        const dailyCashflows = metrics.calculateDailyCashflows(evts, market);
        const { twrHistory, benchmarkHistory } = metrics.calculateTwrHistory(newFullHistory, evts, market, benchmarkSymbol, firstBuyDate, dailyCashflows);
        const portfolioResult = metrics.calculateCoreMetrics(evts, market);

        const netProfitHistory = {};
        let cumulativeCashflow = 0;
        Object.keys(newFullHistory).sort().forEach(dateStr => {
            cumulativeCashflow += (dailyCashflows[dateStr] || 0);
            netProfitHistory[dateStr] = newFullHistory[dateStr] - cumulativeCashflow;
        });

        await maintainSnapshots(uid, newFullHistory, evts, market, createSnapshot);

        const { holdingsToUpdate } = portfolioResult.holdings;
        const holdingsOps = [{ sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] }];
        Object.values(holdingsToUpdate).forEach(h => {
            holdingsOps.push({
                sql: `INSERT INTO holdings (uid, symbol, quantity, currency, avgCostOriginal, totalCostTWD, currentPriceOriginal, marketValueTWD, unrealizedPLTWD, realizedPLTWD, returnRate) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                params: [uid, h.symbol, h.quantity, h.currency, h.avgCostOriginal, h.totalCostTWD, h.currentPriceOriginal, h.marketValueTWD, h.unrealizedPLTWD, h.realizedPLTWD, h.returnRate]
            });
        });
        
        const summaryData = {
            totalRealizedPL: portfolioResult.totalRealizedPL,
            xirr: portfolioResult.xirr,
            overallReturnRate: portfolioResult.overallReturnRate,
            benchmarkSymbol: benchmarkSymbol
        };
        const summaryOps = [
            { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
            {
                sql: `INSERT INTO portfolio_summary (uid, summary_data, history, twrHistory, benchmarkHistory, netProfitHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                params: [uid, JSON.stringify(summaryData), JSON.stringify(newFullHistory), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), JSON.stringify(netProfitHistory), new Date().toISOString()]
            }
        ];
        
        await d1Client.batch(summaryOps);
        const BATCH_SIZE = 900;
        for (let i = 0; i < holdingsOps.length; i += BATCH_SIZE) {
            await d1Client.batch(holdingsOps.slice(i, i + BATCH_SIZE));
        }

        console.log(`--- [${uid}] 同步重算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 計算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

module.exports = { performRecalculation };
