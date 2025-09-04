// =========================================================================================
// == 檔案：functions/calculation/engine.js (v2.2 - Net Profit Baseline from Previous History)
// == 職責：純粹的、可重用的投資組合計算引擎
// =========================================================================================

'use strict';

const { toDate } = require('./helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./state.calculator');
const metrics = require('./metrics.calculator');
const dataProvider = require('./data.provider');

/**
 * 核心計算函式
 * @param {Array} txs - 用於計算的交易紀錄
 * @param {Array} allUserSplits - 使用者所有的拆股事件
 * @param {Array} allUserDividends - 使用者所有的股利事件
 * @param {string} benchmarkSymbol - 比較基準
 * @param {Object|null} [baseSnapshot=null] - (可選) 用於增量計算的基礎快照
 * @param {Object|null} [existingHistory=null] - (可選) 既有「市值歷史」（portfolio history）
 * @param {Object|null} [previousNetProfitHistory=null] - (可選) 既有「累積淨利歷史」，用於承接基線
 * @returns {Promise<Object>} 包含所有計算結果的物件
 */
async function runCalculationEngine(
  txs,
  allUserSplits,
  allUserDividends,
  benchmarkSymbol,
  baseSnapshot = null,
  existingHistory = null,
  previousNetProfitHistory = null
) {
  if (!txs || txs.length === 0) {
    return {
      summaryData: {},
      holdingsToUpdate: {},
      fullHistory: {},
      twrHistory: {},
      benchmarkHistory: {},
      netProfitHistory: {}
    };
  }

  // 1) 確保市場資料就緒
  await dataProvider.ensureAllSymbolsData(txs, benchmarkSymbol);
  const market = await dataProvider.getMarketDataFromDb(txs, benchmarkSymbol);

  // 2) 準備事件與起算日
  const symbolsInScope = new Set(txs.map(t => t.symbol.toUpperCase()));
  const splitsInScope = allUserSplits.filter(s => symbolsInScope.has(s.symbol.toUpperCase()));
  const dividendsInScope = allUserDividends.filter(d => symbolsInScope.has(d.symbol.toUpperCase()));
  const { evts, firstBuyDate } = prepareEvents(txs, splitsInScope, market, dividendsInScope);
  if (!firstBuyDate) {
    return {
      summaryData: {},
      holdingsToUpdate: {},
      fullHistory: {},
      twrHistory: {},
      benchmarkHistory: {},
      netProfitHistory: {},
      evts,
      market
    };
  }

  // 3) 產生市值歷史（支援快照增量）
  let calculationStartDate = firstBuyDate;
  let oldHistory = {};
  if (baseSnapshot && existingHistory) {
    const snapshotDate = toDate(baseSnapshot.snapshot_date);
    oldHistory = existingHistory;
    Object.keys(oldHistory).forEach(dateStr => {
      if (toDate(dateStr) > snapshotDate) delete oldHistory[dateStr];
    });
    const nextDay = new Date(snapshotDate);
    nextDay.setDate(nextDay.getDate() + 1);
    calculationStartDate = nextDay;
  }

  const partialHistory = {};
  const todayForCalc = new Date();
  todayForCalc.setUTCHours(0, 0, 0, 0);

  let curDate = new Date(calculationStartDate);
  while (curDate <= todayForCalc) {
    const dateStr = curDate.toISOString().split('T');
    const state = getPortfolioStateOnDate(evts, curDate, market);
    partialHistory[dateStr] = dailyValue(state, market, curDate, evts);
    curDate.setDate(curDate.getDate() + 1);
  }

  const fullHistory = { ...oldHistory, ...partialHistory };

  // 4) 計算 TWR 與 Benchmark
  const dailyCashflows = metrics.calculateDailyCashflows(evts, market);
  const { twrHistory, benchmarkHistory } =
    metrics.calculateTwrHistory(fullHistory, evts, market, benchmarkSymbol, firstBuyDate, dailyCashflows);

  // 5) 核心指標（持股、XIRR、實現損益等）
  const portfolioResult = metrics.calculateCoreMetrics(evts, market);
  const { holdingsToUpdate } = portfolioResult.holdings;

  // 6) 淨利歷史（以前一日的累積淨利為基線，逐日加總 calculateDailyPL）
  const netProfitHistory = {};
  let cumulativeNetProfit = 0;

  const sortedDates = Object.keys(fullHistory).sort();
  if (sortedDates.length > 0) {
    const firstDateInScope = toDate(sortedDates);
    const dayBeforeFirst = new Date(firstDateInScope);
    dayBeforeFirst.setDate(dayBeforeFirst.getDate() - 1);
    const baselineKey = dayBeforeFirst.toISOString().split('T');

    // 僅從 previousNetProfitHistory 承接基線；若缺少則以 0 起算，避免把市值當淨利
    if (previousNetProfitHistory && typeof previousNetProfitHistory[baselineKey] === 'number') {
      cumulativeNetProfit = Number(previousNetProfitHistory[baselineKey]) || 0;
    } else {
      cumulativeNetProfit = 0;
    }

    for (const dateStr of sortedDates) {
      const today = toDate(dateStr);
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);

      const dailyPL = metrics.calculateDailyPL(today, yesterday, evts, market);
      cumulativeNetProfit += (Number.isFinite(dailyPL) ? dailyPL : 0);
      netProfitHistory[dateStr] = cumulativeNetProfit;
    }
  }

  // 7) 組裝摘要
  const summaryData = {
    totalRealizedPL: portfolioResult.totalRealizedPL,
    xirr: portfolioResult.xirr,
    overallReturnRate: portfolioResult.overallReturnRate,
    benchmarkSymbol: benchmarkSymbol
  };

  return {
    summaryData,
    holdingsToUpdate,
    fullHistory,
    twrHistory,
    benchmarkHistory,
    netProfitHistory,
    evts,
    market
  };
}

module.exports = { runCalculationEngine };
