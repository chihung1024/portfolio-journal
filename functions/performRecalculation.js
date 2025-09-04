// =========================================================================================
// == 檔案：functions/performRecalculation.js (v_final_robust_netprofit_fix)
// == 職責：協調計算引擎，並將結果持久化儲存至資料庫
// =========================================================================================

const { d1Client } = require('./d1.client');
const dataProvider = require('./calculation/data.provider');
const { toDate, isTwStock } = require('./calculation/helpers');
const { getPortfolioStateOnDate, dailyValue } = require('./calculation/state.calculator');
const metrics = require('./calculation/metrics.calculator');
const { runCalculationEngine } = require('./calculation/engine');


const sanitizeNumber = (value) => {
    const num = Number(value);
    return isFinite(num) ? num : 0;
};

async function maintainSnapshots(uid, newFullHistory, evts, market, createSnapshot = false, groupId = 'all') {
    const logPrefix = `[${uid}|G:${groupId}]`;
    console.log(`${logPrefix} 開始維護快照... 強制建立最新快照: ${createSnapshot}`);
    if (!market || Object.keys(newFullHistory).length === 0) {
        console.log(`${logPrefix} 沒有歷史數據或市場數據，跳過快照維護。`);
        return;
    }
    const snapshotOps = [];
    const existingSnapshotsResult = await d1Client.query('SELECT snapshot_date FROM portfolio_snapshots WHERE uid = ? AND group_id = ?', [uid, groupId]);
    const existingSnapshotDates = new Set(existingSnapshotsResult.map(r => r.snapshot_date.split('T')[0]));
    const sortedHistoryDates = Object.keys(newFullHistory).sort();
    const latestDateStr = sortedHistoryDates[sortedHistoryDates.length - 1];
    if (latestDateStr && (createSnapshot || !existingSnapshotDates.has(latestDateStr))) {
        const currentDate = new Date(latestDateStr);
        const finalState = getPortfolioStateOnDate(evts, currentDate, market);
        const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
        snapshotOps.push({
            sql: `INSERT OR REPLACE INTO portfolio_snapshots (uid, group_id, snapshot_date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?, ?)`,
            params: [uid, groupId, latestDateStr, sanitizeNumber(newFullHistory[latestDateStr]), sanitizeNumber(totalCost)]
        });
        existingSnapshotDates.add(latestDateStr);
    }
    for (const dateStr of sortedHistoryDates) {
        const currentDate = new Date(dateStr);
        if (currentDate.getUTCDay() === 6) {
            if (!existingSnapshotDates.has(dateStr)) {
                const finalState = getPortfolioStateOnDate(evts, currentDate, market);
                const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
                snapshotOps.push({
                    sql: `INSERT INTO portfolio_snapshots (uid, group_id, snapshot_date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?, ?)`,
                    params: [uid, groupId, dateStr, sanitizeNumber(newFullHistory[dateStr]), sanitizeNumber(totalCost)]
                });
            }
        }
    }
    if (snapshotOps.length > 0) {
        await d1Client.batch(snapshotOps);
        console.log(`${logPrefix} 成功建立或更新了 ${snapshotOps.length} 筆快照。`);
    } else {
        console.log(`${logPrefix} 快照鏈完整，無需操作。`);
    }
}

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
        if (quantity > 0.00001) {
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

async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    console.log(`--- [${uid}] 儲存式重算程序開始 (v_snapshot_integrated) ---`);
    try {
        const ALL_GROUP_ID = 'all';

        if (createSnapshot === true) {
            console.log(`[${uid}] 收到強制完整重算指令 (createSnapshot=true)，正在清除所有舊快照...`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
        }

        // ========================= 【核心修改 - 開始】 =========================
        const [txs, allUserSplits, allUserDividends, controlsData, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            // 一次性讀取所有需要的歷史數據
            d1Client.query('SELECT history, netProfitHistory FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        ]);

        await calculateAndCachePendingDividends(uid, txs, allUserDividends);
        // ========================= 【核心修改 - 結束】 =========================

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
        
        let oldHistory = {};
        // ========================= 【核心修改 - 開始】 =========================
        let oldNetProfitHistory = {}; // 新增變數來儲存舊的淨利歷史
        // ========================= 【核心修改 - 結束】 =========================
        let baseSnapshot = null;
        
        if (createSnapshot === false) {
            const LATEST_SNAPSHOT_SQL = modifiedTxDate
                ? `SELECT * FROM portfolio_snapshots WHERE uid = ? AND group_id = ? AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1`
                : `SELECT * FROM portfolio_snapshots WHERE uid = ? AND group_id = ? ORDER BY snapshot_date DESC LIMIT 1`;
            const params = modifiedTxDate ? [uid, ALL_GROUP_ID, modifiedTxDate] : [uid, ALL_GROUP_ID];
            const latestValidSnapshotResult = await d1Client.query(LATEST_SNAPSHOT_SQL, params);
            baseSnapshot = latestValidSnapshotResult[0];
        }

        if (baseSnapshot) {
            console.log(`[${uid}] 找到基準快照: ${baseSnapshot.snapshot_date}，將執行增量計算。`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND group_id = ? AND snapshot_date > ?', [uid, ALL_GROUP_ID, baseSnapshot.snapshot_date]);
            if (summaryResult[0]) {
                if (summaryResult[0].history) {
                    oldHistory = JSON.parse(summaryResult[0].history);
                    Object.keys(oldHistory).forEach(date => { if (toDate(date) > baseSnapshot.snapshot_date) delete oldHistory[date]; });
                }
                // ========================= 【核心修改 - 開始】 =========================
                if (summaryResult[0].netProfitHistory) {
                    oldNetProfitHistory = JSON.parse(summaryResult[0].netProfitHistory);
                    // 同樣地，只保留快照日期之前的數據
                    Object.keys(oldNetProfitHistory).forEach(date => { if (toDate(date) > baseSnapshot.snapshot_date) delete oldNetProfitHistory[date]; });
                }
                // ========================= 【核心修改 - 結束】 =========================
            }
        } else {
            console.log(`[${uid}] 找不到有效快照或被強制重算，將執行完整計算。`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
        }
        
        // ========================= 【核心修改 - 開始】 =========================
        const result = await runCalculationEngine(
            txs,
            allUserSplits,
            allUserDividends,
            benchmarkSymbol,
            baseSnapshot,
            oldHistory,
            oldNetProfitHistory // 將舊的淨利歷史傳入引擎
        );
        // ========================= 【核心修改 - 結束】 =========================

        const {
            summaryData,
            holdingsToUpdate,
            fullHistory: newFullHistory,
            twrHistory,
            benchmarkHistory,
            netProfitHistory,
            evts,
            market
        } = result;

        await maintainSnapshots(uid, newFullHistory, evts, market, createSnapshot, ALL_GROUP_ID);

        await d1Client.query('DELETE FROM holdings WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
        await d1Client.query('DELETE FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
        
        const holdingsOps = Object.values(holdingsToUpdate).map(h => ({
            sql: `INSERT INTO holdings (uid, group_id, symbol, quantity, currency, avgCostOriginal, totalCostTWD, currentPriceOriginal, marketValueTWD, unrealizedPLTWD, realizedPLTWD, returnRate, daily_change_percent, daily_pl_twd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            params: [
                uid, ALL_GROUP_ID, h.symbol, sanitizeNumber(h.quantity), h.currency, 
                sanitizeNumber(h.avgCostOriginal), sanitizeNumber(h.totalCostTWD),
                sanitizeNumber(h.currentPriceOriginal), sanitizeNumber(h.marketValueTWD),
                sanitizeNumber(h.unrealizedPLTWD), sanitizeNumber(h.realizedPLTWD),
                sanitizeNumber(h.returnRate), sanitizeNumber(h.daily_change_percent),
                sanitizeNumber(h.daily_pl_twd)
            ]
        }));
        
        const summaryOps = [{
            sql: `INSERT INTO portfolio_summary (uid, group_id, summary_data, history, twrHistory, benchmarkHistory, netProfitHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [uid, ALL_GROUP_ID, JSON.stringify(summaryData), JSON.stringify(newFullHistory), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), JSON.stringify(netProfitHistory), new Date().toISOString()]
        }];
        if (summaryOps.length > 0) await d1Client.batch(summaryOps);
        if (holdingsOps.length > 0) await d1Client.batch(holdingsOps);

        console.log(`--- [${uid}] 儲存式重算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 儲存式重算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

module.exports = { performRecalculation };
