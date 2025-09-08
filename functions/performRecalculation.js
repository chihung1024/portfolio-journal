// =========================================================================================
// == 檔案：functions/performRecalculation.js (v_final_robust - 最終 Bug 修正)
// == 職責：協調計算引擎，並將結果持久化儲存至資料庫
// =========================================================================================

const { d1Client } = require('./d1.client');
const dataProvider = require('./calculation/data.provider');
const { toDate, isTwStock } = require('./calculation/helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./calculation/state.calculator');
const metrics = require('./calculation/metrics.calculator');
// 【修改】導入新的計算引擎
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

async function calculateAndCachePendingDividends(uid, txs, userDividends) {async function calculateAndCachePendingDividends(uid, txs, userDividends) {
  const log = (...args) => console.log(`[${uid}]`, ...args);
  log('開始計算並快取待確認股息…');

  /* 0. 先清空舊快取 */
  await d1Client.batch([
    { sql: 'DELETE FROM user_pending_dividends WHERE uid = ?', params: [uid] }
  ]);

  if (!txs || txs.length === 0) {
    log('使用者無交易紀錄，無需快取股息。');
    return;
  }

  /* 1. 讀取全部市場股息（已排序） */
  const allMarketDividends = await d1Client.query(
    'SELECT symbol, date, dividend FROM dividend_history ORDER BY date ASC'
  );
  if (!allMarketDividends || allMarketDividends.length === 0) {
    log('無市場股息資料，無需快取。');
    return;
  }

  /* 2. 建立已確認股息索引，避免重複 */
  const confirmedKeys = new Set(
    userDividends.map(
      d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`
    )
  );

  /* 3. 依交易時間先後掃描持股數量變化 */
  const holdings = {};      // {SYM: 累計持股}
  let txIndex = 0;          // 指向 txs 中下一筆待處理交易
  const pendingDividends = [];
  const symbolsInTx = [...new Set(txs.map(t => t.symbol.toUpperCase()))];

  for (const histDiv of allMarketDividends) {
    const divSymbol = histDiv.symbol.toUpperCase();
    if (!symbolsInTx.includes(divSymbol)) continue;               // 該用戶沒買過此股
    const exDateStr = histDiv.date.split('T')[0];
    if (confirmedKeys.has(`${divSymbol}_${exDateStr}`)) continue; // 已領取

    /* 3-1. 把所有交易時間 ≤ (除息日前一日) 的交易納入持股計算（FIFO 扫描一次即可） */
    const exDateMinus1 = new Date(exDateStr);
    exDateMinus1.setDate(exDateMinus1.getDate() - 1);
    while (
      txIndex < txs.length &&
      new Date(txs[txIndex].date) <= exDateMinus1
    ) {
      const tx = txs[txIndex];
      const sym = tx.symbol.toUpperCase();
      holdings[sym] = (holdings[sym] || 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity);
      txIndex += 1;
    }

    const quantityAtExDate = holdings[divSymbol] || 0;
    if (quantityAtExDate > 0.00001) {
      /* 4. 判定幣別 (台股預設 TWD，其餘預設 USD) */
      const currency =
        txs.find(t => t.symbol.toUpperCase() === divSymbol)?.currency ||
        (isTwStock(divSymbol) ? 'TWD' : 'USD');

      pendingDividends.push({
        symbol: divSymbol,
        ex_dividend_date: exDateStr,
        amount_per_share: histDiv.dividend,
        quantity_at_ex_date: quantityAtExDate,
        currency
      });
    }
  }

  /* 5. 寫入資料庫 */
  if (pendingDividends.length > 0) {
    const dbOps = pendingDividends.map(p => ({
      sql: `INSERT INTO user_pending_dividends
              (uid, symbol, ex_dividend_date, amount_per_share, quantity_at_ex_date, currency)
            VALUES (?,?,?,?,?,?)`,
      params: [
        uid,
        p.symbol,
        p.ex_dividend_date,
        p.amount_per_share,
        p.quantity_at_ex_date,
        p.currency
      ]
    }));
    await d1Client.batch(dbOps);
    log(`成功快取 ${pendingDividends.length} 筆待確認股息。`);
  } else {
    log('沒有新的待確認股息需要快取。');
  }
}

async function performRecalculation(uid, modifiedTxDate = null, createSnapshot = false) {
    console.log(`--- [${uid}] 儲存式重算程序開始 (v_snapshot_integrated) ---`);
    try {
        const ALL_GROUP_ID = 'all';

        if (createSnapshot === true) {
            console.log(`[${uid}] 收到強制完整重算指令 (createSnapshot=true)，正在清除所有舊快照...`);
            await d1Client.query('DELETE FROM portfolio_snapshots WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]);
        }

        // ========================= 【核心修正 - 開始】 =========================
        // 【簡化】一次性抓取所有需要的原始數據
        const [txs, allUserSplits, allUserDividends, controlsData, summaryResult] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT history FROM portfolio_summary WHERE uid = ? AND group_id = ?', [uid, ALL_GROUP_ID]),
        ]);

        await calculateAndCachePendingDividends(uid, txs, allUserDividends);
        // ========================= 【核心修正 - 結束】 =========================

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

        // ========================= 【核心修正 - 開始】 =========================
        // 【簡化】移除舊的手動數據準備步驟 (prepareEvents)
        // ========================= 【核心修正 - 結束】 =========================
        
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
        
        // ========================= 【核心修正 - 開始】 =========================
        // 【簡化】呼叫統一的計算引擎，傳入所有原始數據
        const result = await runCalculationEngine(
            txs,
            allUserSplits,
            allUserDividends,
            benchmarkSymbol,
            baseSnapshot,
            oldHistory
        );
        // ========================= 【核心修正 - 結束】 =========================


        // 【修改】從引擎的回傳結果中獲取計算好的數據
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
