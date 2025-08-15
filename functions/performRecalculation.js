// =========================================================================================
// == 檔案：functions/performRecalculation.js (v_final_group_id_fix - 修正 group_id 處理)
// == 職責：協調計算引擎，並將結果持久化儲存至資料庫
// =========================================================================================

const { d1Client } = require('./d1.client');
const { toDate, isTwStock } = require('./calculation/helpers');
const { runCalculationEngine } = require('./calculation/engine');
const { getPortfolioStateOnDate } = require('./calculation/state.calculator');

async function maintainSnapshots(uid, newFullHistory, evts, market, createSnapshot = false, groupId = 'all') {
    const logPrefix = `[${uid}|G:${groupId}]`;
    console.log(`${logPrefix} 開始維護快照... 強制建立最新快照: ${createSnapshot}`);
    if (Object.keys(newFullHistory).length === 0) {
        console.log(`${logPrefix} 沒有歷史數據，跳過快照維護。`);
        return;
    }

    const snapshotOps = [];
    // 【核心修正】查詢時使用明確的 group_id
    const existingSnapshotsResult = await d1Client.query('SELECT snapshot_date FROM portfolio_snapshots WHERE uid = ? AND group_id = ?', [uid, groupId]);
    const existingSnapshotDates = new Set(existingSnapshotsResult.map(r => r.snapshot_date.split('T')[0]));
    const sortedHistoryDates = Object.keys(newFullHistory).sort();
    
    const latestDateStr = sortedHistoryDates[sortedHistoryDates.length - 1];
    if (latestDateStr && (createSnapshot || !existingSnapshotDates.has(latestDateStr))) {
        const currentDate = new Date(latestDateStr);
        const finalState = getPortfolioStateOnDate(evts, currentDate, market);
        const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
        
        snapshotOps.push({
            // 【核心修正】插入時使用明確的 group_id
            sql: `INSERT OR REPLACE INTO portfolio_snapshots (uid, group_id, snapshot_date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?, ?)`,
            params: [uid, groupId, latestDateStr, newFullHistory[latestDateStr], totalCost]
        });
        existingSnapshotDates.add(latestDateStr);
    }

    for (const dateStr of sortedHistoryDates) {
        const currentDate = new Date(dateStr);
        if (currentDate.getUTCDay() === 6) { // 6 代表週六
            if (!existingSnapshotDates.has(dateStr)) {
                const finalState = getPortfolioStateOnDate(evts, currentDate, market);
                const totalCost = Object.values(finalState).reduce((s, stk) => s + stk.lots.reduce((ls, l) => ls + l.quantity * l.pricePerShareTWD, 0), 0);
                
                snapshotOps.push({
                    // 【核心修正】插入時使用明確的 group_id
                    sql: `INSERT INTO portfolio_snapshots (uid, group_id, snapshot_date, market_value_twd, total_cost_twd) VALUES (?, ?, ?, ?, ?)`,
                    params: [uid, groupId, dateStr, newFullHistory[dateStr], totalCost]
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


/**
 * 協調函式：準備數據、呼叫計算引擎、並儲存結果
 */
async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    console.log(`--- [${uid}] 儲存式重算程序開始 (使用 'all' 作為預設群組 ID) ---`);
    try {
        const ALL_GROUP_ID = 'all'; // 【核心修正】定義一個常量來代表 "全部股票"

        // 1. 準備母數據 (永遠是全部的交易)
        const [txs, splits, controlsData, userDividends, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT history FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
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

        // 2. 呼叫計算引擎
        const calculationResult = await runCalculationEngine(
            txs,
            splits,
            userDividends,
            benchmarkSymbol
        );

        const {
            summaryData,
            holdingsToUpdate,
            fullHistory,
            twrHistory,
            benchmarkHistory,
            netProfitHistory,
            evts
        } = calculationResult;

        // 在儲存前，先維護快照
        await maintainSnapshots(uid, fullHistory, evts, null, createSnapshot, ALL_GROUP_ID);

        // 3. 儲存計算結果
        await d1Client.batch([
             { sql: 'DELETE FROM holdings WHERE uid = ? AND group_id = ?', params: [uid, ALL_GROUP_ID] },
             { sql: 'DELETE FROM portfolio_summary WHERE uid = ? AND group_id = ?', params: [uid, ALL_GROUP_ID] },
        ]);

        const holdingsOps = [];
        Object.values(holdingsToUpdate).forEach(h => {
            holdingsOps.push({
                sql: `INSERT INTO holdings (uid, group_id, symbol, quantity, currency, avgCostOriginal, totalCostTWD, currentPriceOriginal, marketValueTWD, unrealizedPLTWD, realizedPLTWD, returnRate, daily_change_percent, daily_pl_twd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                params: [uid, ALL_GROUP_ID, h.symbol, h.quantity, h.currency, h.avgCostOriginal, h.totalCostTWD, h.currentPriceOriginal, h.marketValueTWD, h.unrealizedPLTWD, h.realizedPLTWD, h.returnRate, h.daily_change_percent, h.daily_pl_twd]
            });
        });
        
        const summaryOps = [{
            sql: `INSERT INTO portfolio_summary (uid, group_id, summary_data, history, twrHistory, benchmarkHistory, netProfitHistory, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [uid, ALL_GROUP_ID, JSON.stringify(summaryData), JSON.stringify(fullHistory), JSON.stringify(twrHistory), JSON.stringify(benchmarkHistory), JSON.stringify(netProfitHistory), new Date().toISOString()]
        }];
        
        await d1Client.batch(summaryOps);
        const BATCH_SIZE = 500;
        for (let i = 0; i < holdingsOps.length; i += BATCH_SIZE) {
            await d1Client.batch(holdingsOps.slice(i, i + BATCH_SIZE));
        }

        console.log(`--- [${uid}] 儲存式重算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 儲存式重算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

module.exports = { performRecalculation };
