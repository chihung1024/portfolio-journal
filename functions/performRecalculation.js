// =========================================================================================
// == 檔案：functions/performRecalculation.js (v_ga_timezone_hotfix)
// == 版本：GA Hotfix - 修正日期時區處理不一致的根本缺陷
// == 職責：協調計算引擎，並將結果持久化儲存至資料庫
// =========================================================================================

const { d1Client } = require('./d1.client');
const dataProvider = require('./calculation/data.provider');
const { toDate, isTwStock } = require('./calculation/helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./calculation/state.calculator');
const metrics = require('./calculation/metrics.calculator');
const { runCalculationEngine } = require('./calculation/engine');

const sanitizeNumber = (value) => {
    const num = Number(value);
    return isFinite(num) ? num : 0;
};

async function maintainSnapshots(uid, newFullHistory, evts, market, createSnapshot = false, groupId = 'all') {
    // ... [此函式未變更，保持原樣] ...
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


// ========================= 【時區修正 + 高效能重構方案 - 開始】 =========================
/**
 * @notice 計算並快取待確認股息 (時區修正 + 效能優化版)
 * @dev 此函式採用事件驅動時間軸方法，並強制所有日期解析為 UTC，確保時區一致性。
 * @param {string} uid 使用者 ID
 * @param {Array<Object>} txs 使用者的所有交易紀錄
 * @param {Array<Object>} userDividends 使用者已手動確認的股息紀錄
 */
async function calculateAndCachePendingDividends(uid, txs, userDividends) {
    const logPrefix = `[${uid}]`;
    console.log(`${logPrefix} 開始計算待確認股息 (v4 - 時區修正演算法)...`);

    await d1Client.batch([{ sql: 'DELETE FROM user_pending_dividends WHERE uid = ?', params: [uid] }]);
    if (!txs || txs.length === 0) {
        console.log(`${logPrefix} 使用者無交易紀錄，跳過股息計算。`);
        return;
    }

    const userSymbols = [...new Set(txs.map(tx => tx.symbol.toUpperCase()))];
    if (userSymbols.length === 0) {
        console.log(`${logPrefix} 無有效股票代碼，跳過股息計算。`);
        return;
    }
    const placeholders = userSymbols.map(() => '?').join(',');
    const marketDividends = await d1Client.query(`SELECT * FROM dividend_history WHERE symbol IN (${placeholders}) ORDER BY date ASC`, userSymbols);

    if (!marketDividends || marketDividends.length === 0) {
        console.log(`${logPrefix} 根據使用者持倉，未找到相關的市場股息資料。`);
        return;
    }

    // 強化日期格式處理，確保鍵值一致性
    const toYMD = (dateInput) => {
        if (!dateInput) return null;
        const d = (dateInput instanceof Date) ? dateInput : toDate(dateInput);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
    };
    
    const confirmedKeys = new Set(userDividends.map(d => {
        const keyDate = toYMD(d.ex_dividend_date);
        return keyDate ? `${d.symbol.toUpperCase()}_${keyDate}` : null;
    }).filter(Boolean));

    const transactionEvents = txs.map(tx => ({
        type: 'transaction',
        // 【核心修正】: 統一使用 toDate 輔助函式，確保所有日期被視為 UTC
        date: toDate(tx.date),
        data: tx
    }));

    const dividendEvents = marketDividends.map(div => {
        // 【核心修正】: 統一使用 toDate 輔助函式
        const exDate = toDate(div.date);
        const exDateMinusOneEOD = new Date(exDate.getTime() - 1);
        return {
            type: 'dividend_ex_date',
            date: exDateMinusOneEOD,
            data: div
        };
    });
    
    const timeline = [...transactionEvents, ...dividendEvents].sort((a, b) => a.date - b.date);

    const portfolioState = {};
    const lastCurrency = {};
    const pendingDividends = [];

    for (const event of timeline) {
        const symbol = event.data.symbol.toUpperCase();

        if (event.type === 'transaction') {
            const tx = event.data;
            portfolioState[symbol] = (portfolioState[symbol] || 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity);
            lastCurrency[symbol] = tx.currency;
        } else if (event.type === 'dividend_ex_date') {
            const div = event.data;
            const exDateStr = toYMD(div.date);
            const quantity = portfolioState[symbol] || 0;
            
            if (exDateStr && quantity > 1e-9 && !confirmedKeys.has(`${symbol}_${exDateStr}`)) {
                pendingDividends.push({
                    symbol: symbol,
                    ex_dividend_date: exDateStr, // 使用標準化的 YYYY-MM-DD 格式
                    amount_per_share: div.dividend,
                    quantity_at_ex_date: quantity,
                    currency: lastCurrency[symbol] || (isTwStock(symbol) ? 'TWD' : 'USD')
                });
            }
        }
    }

    if (pendingDividends.length > 0) {
        const dbOps = pendingDividends.map(p => ({
            sql: `INSERT INTO user_pending_dividends (uid, symbol, ex_dividend_date, amount_per_share, quantity_at_ex_date, currency) VALUES (?, ?, ?, ?, ?, ?)`,
            params: [uid, p.symbol, p.ex_dividend_date, p.amount_per_share, p.quantity_at_ex_date, p.currency]
        }));
        await d1Client.batch(dbOps);
    }
    console.log(`${logPrefix} 成功快取 ${pendingDividends.length} 筆待確認股息。`);
}
// ========================= 【時區修正 + 高效能重構方案 - 結束】 =========================

async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    console.log(`--- [${uid}] 儲存式重算程序開始 (v_final_timezone_fix) ---`);
    try {
        const ALL_GROUP_ID = 'all';

        if (createSnapshot === true) {
            console.log(`[${uid}] 收到強制完整重算指令 (createSnapshot=true)，正在清除所有舊快照...`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
        }

        const [txs, allUserSplits, allUserDividends, controlsData, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT history FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        ]);
        
        await calculateAndCachePendingDividends(uid, txs, allUserDividends);

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
            if (summaryResult[0] && summaryResult[0].history) {
                oldHistory = JSON.parse(summaryResult[0].history);
                Object.keys(oldHistory).forEach(date => { if (toDate(date) > baseSnapshot.snapshot_date) delete oldHistory[date]; });
            }
        } else {
            console.log(`[${uid}] 找不到有效快照或被強制重算，將執行完整計算。`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
        }
        
        const result = await runCalculationEngine(
            txs,
            allUserSplits,
            allUserDividends,
            benchmarkSymbol,
            baseSnapshot,
            oldHistory
        );

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

