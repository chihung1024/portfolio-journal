// =========================================================================================
// == 檔案：functions/performRecalculation.js (v_ga_performance_optimized)
// == 版本：GA - 採納 Code Review 意見，以線性時間複雜度重構
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


// ========================= 【高效能重構方案 - 開始】 =========================
/**
 * @notice 計算並快取待確認股息 (效能優化版)
 * @dev 此函式採用事件驅動時間軸方法，將時間複雜度降至 O(N log N)，其中 N 是交易和相關配息事件的總數。
 * 它能高效、準確地處理大規模數據，並內建多項優化與邊界條件處理。
 * @param {string} uid 使用者 ID
 * @param {Array<Object>} txs 使用者的所有交易紀錄
 * @param {Array<Object>} userDividends 使用者已手動確認的股息紀錄
 */
async function calculateAndCachePendingDividends(uid, txs, userDividends) {
    const logPrefix = `[${uid}]`;
    console.log(`${logPrefix} 開始計算待確認股息 (v3 - 高效能時間軸演算法)...`);

    // 步驟 0: 初始清理與前置檢查
    await d1Client.batch([{ sql: 'DELETE FROM user_pending_dividends WHERE uid = ?', params: [uid] }]);
    if (!txs || txs.length === 0) {
        console.log(`${logPrefix} 使用者無交易紀錄，跳過股息計算。`);
        return;
    }

    // 步驟 1: 資料庫查詢優化
    // 從交易紀錄中提取所有相關的股票代碼，以最小化市場配息的查詢範圍。
    const userSymbols = [...new Set(txs.map(tx => tx.symbol.toUpperCase()))];
    const placeholders = userSymbols.map(() => '?').join(',');
    const marketDividends = await d1Client.query(`SELECT * FROM dividend_history WHERE symbol IN (${placeholders}) ORDER BY date ASC`, userSymbols);

    if (!marketDividends || marketDividends.length === 0) {
        console.log(`${logPrefix} 根據使用者持倉，未找到相關的市場股息資料。`);
        return;
    }

    // 建立已確認配息的快速查找集合，鍵值為 'SYMBOL_YYYY-MM-DD'
    const confirmedKeys = new Set(userDividends.map(d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`));

    // 步驟 2: 建立統一事件時間軸
    // 將交易和市場配息兩種事件合併，並按時間精確排序。
    const transactionEvents = txs.map(tx => ({
        type: 'transaction',
        // 確保 Date 物件轉換的一致性
        date: new Date(tx.date), 
        data: tx
    }));

    const dividendEvents = marketDividends.map(div => {
        const exDate = new Date(div.date);
        // **關鍵**：將除息事件的時間設為除息日前一天的結束，確保它在排序後
        // 能正確反映除息日前一天的持股狀態。
        const exDateMinusOneEOD = new Date(exDate.getTime() - 1);
        return {
            type: 'dividend_ex_date',
            date: exDateMinusOneEOD,
            data: div
        };
    });
    
    // 合併並排序所有事件，建立一個統一的時間軸
    const timeline = [...transactionEvents, ...dividendEvents].sort((a, b) => a.date - b.date);

    // 步驟 3: 遍歷時間軸並計算狀態
    const portfolioState = {}; // { 'AAPL': 100, 'GOOG': 50 }
    const lastCurrency = {};   // { 'AAPL': 'USD' }，用於健壯的貨幣判斷
    const pendingDividends = [];

    for (const event of timeline) {
        const symbol = event.data.symbol.toUpperCase();

        if (event.type === 'transaction') {
            const tx = event.data;
            portfolioState[symbol] = (portfolioState[symbol] || 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity);
            // 持續更新每支股票的最後交易貨幣
            lastCurrency[symbol] = tx.currency;
        } else if (event.type === 'dividend_ex_date') {
            const div = event.data;
            const exDateStr = div.date.split('T')[0];
            const quantity = portfolioState[symbol] || 0;
            
            // 檢查是否符合待確認條件：持股 > 0 且尚未被使用者確認
            if (quantity > 1e-9 && !confirmedKeys.has(`${symbol}_${exDateStr}`)) {
                pendingDividends.push({
                    symbol: symbol,
                    ex_dividend_date: exDateStr,
                    amount_per_share: div.dividend,
                    quantity_at_ex_date: quantity,
                    // 使用最後已知的貨幣，比 txs.find() 更健壯
                    currency: lastCurrency[symbol] || (isTwStock(symbol) ? 'TWD' : 'USD')
                });
            }
        }
    }

    // 步驟 4: 結果持久化
    if (pendingDividends.length > 0) {
        const dbOps = pendingDividends.map(p => ({
            sql: `INSERT INTO user_pending_dividends (uid, symbol, ex_dividend_date, amount_per_share, quantity_at_ex_date, currency) VALUES (?, ?, ?, ?, ?, ?)`,
            params: [uid, p.symbol, p.ex_dividend_date, p.amount_per_share, p.quantity_at_ex_date, p.currency]
        }));
        await d1Client.batch(dbOps);
    }
    console.log(`${logPrefix} 成功快取 ${pendingDividends.length} 筆待確認股息。`);
}
// ========================= 【高效能重構方案 - 結束】 =========================

async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    console.log(`--- [${uid}] 儲存式重算程序開始 (v_perf_optimized) ---`);
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
        
        // 呼叫全新優化後的函式
        await calculateAndCachePendingDividends(uid, txs, allUserDividends);

        if (txs.length === 0) {
            // ... [此邏輯未變更，保持原樣] ...
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
             // ... [此邏輯未變更，保持原樣] ...
            const LATEST_SNAPSHOT_SQL = modifiedTxDate
                ? `SELECT * FROM portfolio_snapshots WHERE uid = ? AND group_id = ? AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1`
                : `SELECT * FROM portfolio_snapshots WHERE uid = ? AND group_id = ? ORDER BY snapshot_date DESC LIMIT 1`;
            const params = modifiedTxDate ? [uid, ALL_GROUP_ID, modifiedTxDate] : [uid, ALL_GROUP_ID];
            const latestValidSnapshotResult = await d1Client.query(LATEST_SNAPSHOT_SQL, params);
            baseSnapshot = latestValidSnapshotResult[0];
        }

        if (baseSnapshot) {
            // ... [此邏輯未變更，保持原樣] ...
            console.log(`[${uid}] 找到基準快照: ${baseSnapshot.snapshot_date}，將執行增量計算。`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND group_id = ? AND snapshot_date > ?', [uid, ALL_GROUP_ID, baseSnapshot.snapshot_date]);
            if (summaryResult[0] && summaryResult[0].history) {
                oldHistory = JSON.parse(summaryResult[0].history);
                Object.keys(oldHistory).forEach(date => { if (toDate(date) > baseSnapshot.snapshot_date) delete oldHistory[date]; });
            }
        } else {
             // ... [此邏輯未變更，保持原樣] ...
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
