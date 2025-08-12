// =========================================================================================
// == 主重算流程調度器 (performRecalculation.js) - PROFILING & COMPLETE VERSION
// =========================================================================================

const { d1Client } = require('./d1.client');
const dataProvider = require('./calculation/data.provider');
const { toDate, isTwStock } = require('./calculation/helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./calculation/state.calculator');
const metrics = require('./calculation/metrics.calculator');


// 負責快取用戶的待確認股息 (此函式內容與您目前版本完全相同，保持不變)
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
 * 主計算函式 (內置計時器，完整內容)
 */
async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    // 【新增】計時器開始
    const fullProcessStart = Date.now();
    console.log(`--- [${uid}] 重新計算程序開始 (v_performance_profiling) ---`);
    
    try {
        // 步驟 1: 讀取使用者基本資料
        let timer = Date.now();
        const [txs, splits, controlsData, userDividends, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT history FROM portfolio_summary WHERE uid = ?', [uid]),
        ]);
        console.log(`[PERF] 1. 讀取使用者基本資料: ${Date.now() - timer} ms`);

        // 步驟 2: 更新待確認股息
        timer = Date.now();
        await calculateAndCachePendingDividends(uid, txs, userDividends);
        console.log(`[PERF] 2. 更新待確認股息: ${Date.now() - timer} ms`);

        // 步驟 3: 處理無交易的特殊情況
        if (txs.length === 0) {
            await d1Client.batch([
                { sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM user_dividends WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_snapshots WHERE uid = ?', params: [uid] }
            ]);
            return;
        }

        // 步驟 4: 確定所有需要的市場數據代碼
        timer = Date.now();
        const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';
        const symbolsInPortfolio = [...new Set(txs.map(t => t.symbol.toUpperCase()))];
        const currencies = [...new Set(txs.map(t => t.currency))].filter(c => c !== "TWD");
        const requiredFxSymbols = currencies.map(c => ({ "USD": "TWD=X", "HKD": "HKDTWD=X", "JPY": "JPYTWD=X" }[c])).filter(Boolean);
        const allRequiredSymbols = [...new Set([...symbolsInPortfolio, benchmarkSymbol.toUpperCase(), ...requiredFxSymbols])].filter(Boolean);
        console.log(`[PERF] 4. 確定所需代碼: ${Date.now() - timer} ms`);

        // 步驟 5: 確保市場數據在資料庫中是最新且完整的
        timer = Date.now();
        await dataProvider.ensureDataFreshness(allRequiredSymbols);
        const firstTxDateStr = txs[0].date.split('T')[0];
        await Promise.all(allRequiredSymbols.map(symbol => dataProvider.ensureDataCoverage(symbol, firstTxDateStr)));
        console.log(`[PERF] 5. 確保市場數據新鮮度 (包含潛在的網路下載): ${Date.now() - timer} ms`);

        // 步驟 6: 從資料庫讀取市場數據到記憶體
        timer = Date.now();
        const market = await dataProvider.getMarketDataFromDb(txs, benchmarkSymbol);
        console.log(`[PERF] 6. 從DB讀取市場數據: ${Date.now() - timer} ms`);
        
        // 步驟 7: 準備事件列表
        timer = Date.now();
        const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);
        if (!firstBuyDate) {
            console.log(`[${uid}] 找不到首次交易日期，計算中止。`);
            return;
        }
        const eventsByDate = evts.reduce((acc, e) => {
            const dateStr = toDate(e.date).toISOString().split('T')[0];
            if (!acc[dateStr]) acc[dateStr] = [];
            acc[dateStr].push(e);
            return acc;
        }, {});
        console.log(`[PERF] 7. 準備事件列表: ${Date.now() - timer} ms`);

        // 步驟 8: 每日價值計算 (高效能迴圈)
        timer = Date.now();
        let calculationStartDate = firstBuyDate;
        let oldHistory = {};
        const latestSnapshotResult = await d1Client.query('SELECT * FROM portfolio_snapshots WHERE uid = ? ORDER BY snapshot_date DESC LIMIT 1', [uid]);
        let latestSnapshot = latestSnapshotResult[0];
        if (latestSnapshot && modifiedTxDate && toDate(modifiedTxDate) <= toDate(latestSnapshot.snapshot_date)) {
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND snapshot_date >= ?', [uid, modifiedTxDate]);
            const newLatestSnapshotResult = await d1Client.query('SELECT * FROM portfolio_snapshots WHERE uid = ? ORDER BY snapshot_date DESC LIMIT 1', [uid]);
            latestSnapshot = newLatestSnapshotResult[0];
        }
        if (latestSnapshot) {
            const snapshotDate = toDate(latestSnapshot.snapshot_date);
            if (summaryResult[0] && summaryResult[0].history) {
                oldHistory = JSON.parse(summaryResult[0].history);
                Object.keys(oldHistory).forEach(date => { if (toDate(date) > snapshotDate) delete oldHistory[date]; });
            }
            const nextDay = new Date(snapshotDate); nextDay.setDate(nextDay.getDate() + 1);
            calculationStartDate = nextDay;
            console.log(`[${uid}] 將從快照點 ${latestSnapshot.snapshot_date} 之後開始混合計算。`);
        } else {
            console.log(`[${uid}] 找不到任何有效快照，將從頭開始完整計算。`);
        }

        const partialHistory = {};
        const dayBeforeStartDate = new Date(calculationStartDate.getTime() - 86400000);
        let currentState = getPortfolioStateOnDate(evts, dayBeforeStartDate, market);
        let curDate = new Date(calculationStartDate);
        const today = new Date(); today.setUTCHours(0, 0, 0, 0);

        if (curDate <= today) {
            while (curDate <= today) {
                const dateStr = curDate.toISOString().split('T')[0];
                const dailyEvents = eventsByDate[dateStr] || [];
                if (dailyEvents.length > 0) {
                     currentState = getPortfolioStateOnDate(evts, curDate, market);
                }
                partialHistory[dateStr] = dailyValue(currentState, market, curDate, evts);
                curDate.setDate(curDate.getDate() + 1);
            }
        }
        const newFullHistory = { ...oldHistory, ...partialHistory };
        console.log(`[PERF] 8. 每日價值計算迴圈: ${Date.now() - timer} ms`);

        // 步驟 9: 計算所有核心財務指標
        timer = Date.now();
        const dailyCashflows = metrics.calculateDailyCashflows(evts, market);
        const { twrHistory, benchmarkHistory } = metrics.calculateTwrHistory(newFullHistory, evts, market, benchmarkSymbol, firstBuyDate, dailyCashflows);
        const portfolioResult = metrics.calculateCoreMetrics(evts, market);
        const netProfitHistory = {};
        let cumulativeCashflow = 0;
        Object.keys(newFullHistory).sort().forEach(dateStr => {
            cumulativeCashflow += (dailyCashflows[dateStr] || 0);
            netProfitHistory[dateStr] = newFullHistory[dateStr] - cumulativeCashflow;
        });
        console.log(`[PERF] 9. 計算核心指標 (TWR, XIRR, P/L): ${Date.now() - timer} ms`);

        // 步驟 10: 儲存快照
        if (createSnapshot) {
            const lastDate = Object.keys(newFullHistory).pop();
            if (lastDate) {
                const finalState = getPortfolioStateOnDate(evts, new Date(lastDate), market);
                const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
                await d1Client.query(
                    `INSERT OR REPLACE INTO portfolio_snapshots (uid, snapshot_date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?)`,
                    [uid, lastDate, newFullHistory[lastDate], totalCost]
                );
                console.log(`[${uid}] 已成功建立 ${lastDate} 的快照。`);
            }
        }
        
        // 步驟 11: 將所有計算結果寫入資料庫
        timer = Date.now();
        const { holdingsToUpdate } = portfolioResult.holdings;
        const dbOps = [{ sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] }];
        Object.values(holdingsToUpdate).forEach(h => {
            dbOps.push({
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
        for (let i = 0; i < dbOps.length; i += BATCH_SIZE) {
            await d1Client.batch(dbOps.slice(i, i + BATCH_SIZE));
        }
        console.log(`[PERF] 11. 寫入結果至DB: ${Date.now() - timer} ms`);
        
    } catch (e) {
        console.error(`[${uid}] 計算期間發生嚴重錯誤：`, e);
        throw e;
    } finally {
        console.log(`--- [${uid}] 重新計算程序總耗時: ${Date.now() - fullProcessStart} ms ---`);
    }
}

module.exports = { performRecalculation };
