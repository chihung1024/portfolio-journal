// =========================================================================================
// == 檔案：functions/performRecalculation.js (完整版 - 精準週六快照策略)
// == 職責：被背景任務 worker 呼叫，執行完整的重算、指標分析與快照維護。
// =========================================================================================

const { d1Client } = require('./d1.client');
const dataProvider = require('./calculation/data.provider');
const { toDate } = require('./calculation/helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./calculation/state.calculator');
const metrics = require('./calculation/metrics.calculator');

// Cloudflare D1 (SQLite) 中，'6' 代表週六
const SATURDAY_WEEKDAY_INDEX = '6';

async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    console.log(`--- [${uid}] 背景重算程序開始 (週六快照策略) ---`);
    console.log(`--- 修改日期: ${modifiedTxDate}, 強制快照: ${createSnapshot} ---`);

    try {
        // 步驟 1: 獲取所有必要的原始數據
        const [txs, splits, controlsData, userDividends, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT history FROM portfolio_summary WHERE uid = ?', [uid]),
        ]);

        await dataProvider.calculateAndCachePendingDividends(uid, txs, userDividends);

        if (txs.length === 0) {
            // 清理該使用者的所有數據
            await d1Client.batch([
                { sql: 'DELETE FROM holdings WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_summary WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM user_dividends WHERE uid = ?', params: [uid] },
                { sql: 'DELETE FROM portfolio_snapshots WHERE uid = ?', params: [uid] }
            ]);
            console.log(`[${uid}] 使用者無交易紀錄，已清理所有相關資料。`);
            return;
        }

        // 步驟 2: 準備市場數據
        const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';
        const market = await dataProvider.getMarketDataForDb(txs, benchmarkSymbol);

        // 步驟 3: 準備事件流和計算邊界
        const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);
        if (!firstBuyDate) {
            console.log(`[${uid}] 找不到首次交易日期，計算中止。`);
            return;
        }

        let calculationStartDate = firstBuyDate;
        let oldHistory = {};

        // ========================【快照處理核心邏輯 - 開始】========================

        const LATEST_SATURDAY_SNAPSHOT_SQL = modifiedTxDate
            ? `SELECT * FROM portfolio_snapshots WHERE uid = ? AND strftime('%w', date) = ? AND date < ? ORDER BY date DESC LIMIT 1`
            : `SELECT * FROM portfolio_snapshots WHERE uid = ? AND strftime('%w', date) = ? ORDER BY date DESC LIMIT 1`;
        
        const params = modifiedTxDate ? [uid, SATURDAY_WEEKDAY_INDEX, modifiedTxDate] : [uid, SATURDAY_WEEKDAY_INDEX];
        const latestValidSnapshotResult = await d1Client.query(LATEST_SATURDAY_SNAPSHOT_SQL, params);
        const baseSnapshot = latestValidSnapshotResult[0];

        if (baseSnapshot) {
            console.log(`[${uid}] 找到基準快照: ${baseSnapshot.date} (週六)`);
            
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND date > ?', [uid, baseSnapshot.date]);
            console.log(`[${uid}] 已清理 ${baseSnapshot.date} 之後的所有快照。`);

            if (summaryResult[0] && summaryResult[0].history) {
                oldHistory = JSON.parse(summaryResult[0].history);
                const snapshotDate = toDate(baseSnapshot.date);
                Object.keys(oldHistory).forEach(date => { if (toDate(date) > snapshotDate) delete oldHistory[date]; });
            }
            const nextDay = new Date(baseSnapshot.date);
            nextDay.setDate(nextDay.getDate() + 1);
            calculationStartDate = nextDay;
        } else {
            console.log(`[${uid}] 找不到任何有效快照，將執行完整計算並清理所有舊快照。`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ?', [uid]);
        }

        // ========================【快照處理核心邏輯 - 結束】========================
        
        // 步驟 4: 執行每日價值計算
        const partialHistory = {};
        let curDate = new Date(calculationStartDate);
        const today = new Date(); today.setUTCHours(0, 0, 0, 0);

        if (curDate <= today) {
            console.log(`[${uid}] 執行每日價值計算: ${curDate.toISOString().split('T')[0]} -> 今天`);
            while (curDate <= today) {
                const dateStr = curDate.toISOString().split('T')[0];
                partialHistory[dateStr] = dailyValue(getPortfolioStateOnDate(evts, curDate, market), market, curDate, evts);
                curDate.setDate(curDate.getDate() + 1);
            }
        }
        const newFullHistory = { ...oldHistory, ...partialHistory };

        // 步驟 5: 計算所有核心指標
        const dailyCashflows = metrics.calculateDailyCashflows(evts, market);
        const { twrHistory, benchmarkHistory } = metrics.calculateTwrHistory(newFullHistory, evts, market, benchmarkSymbol, firstBuyDate, dailyCashflows);
        const portfolioResult = metrics.calculateCoreMetrics(evts, market);
        const netProfitHistory = metrics.calculateNetProfitHistory(newFullHistory, dailyCashflows);

        // ========================【快照回補核心邏輯 - 開始】========================

        // 檢查並回補遺失的週六快照
        const snapshotOps = [];
        const existingSnapshotsResult = await d1Client.query('SELECT date FROM portfolio_snapshots WHERE uid = ?', [uid]);
        const existingSnapshotDates = new Set(existingSnapshotsResult.map(r => r.date));
        
        const sortedHistoryDates = Object.keys(newFullHistory).sort();
        
        for (const dateStr of sortedHistoryDates) {
            const currentDate = new Date(dateStr);
            if (currentDate.getUTCDay() === 6 && !existingSnapshotDates.has(dateStr)) {
                const finalState = getPortfolioStateOnDate(evts, currentDate, market);
                const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
                
                snapshotOps.push({
                    sql: `INSERT INTO portfolio_snapshots (uid, date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?)`,
                    params: [uid, dateStr, newFullHistory[dateStr], totalCost]
                });
            }
        }
        
        // 如果週末校驗腳本觸發，也建立當天的快照
        const lastDateStr = sortedHistoryDates.pop();
        if (createSnapshot && lastDateStr && !existingSnapshotDates.has(lastDateStr)) {
            const finalState = getPortfolioStateOnDate(evts, new Date(lastDateStr), market);
            const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
            snapshotOps.push({
                sql: `INSERT OR REPLACE INTO portfolio_snapshots (uid, date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?)`,
                params: [uid, lastDateStr, newFullHistory[lastDateStr], totalCost]
            });
        }
        
        if (snapshotOps.length > 0) {
            await d1Client.batch(snapshotOps);
            console.log(`[${uid}] 成功回補或建立了 ${snapshotOps.length} 筆快照。`);
        }

        // ========================【快照回補核心邏輯 - 結束】========================

        // 步驟 6: 將最終計算結果寫入資料庫
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
        
        // 分批執行資料庫操作以防超出限制
        await d1Client.batch(summaryOps);
        const BATCH_SIZE = 900;
        for (let i = 0; i < holdingsOps.length; i += BATCH_SIZE) {
            await d1Client.batch(holdingsOps.slice(i, i + BATCH_SIZE));
        }

        console.log(`--- [${uid}] 背景重算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 背景計算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

module.exports = { performRecalculation };
