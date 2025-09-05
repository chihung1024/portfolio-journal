// =========================================================================================
// == 檔案：functions/calculation/engine.js (v3.0 - Unified Profit Model)
// == 職責：作為系統唯一的、權威的投資組合計算引擎，確保所有損益指標同源且一致。
// =========================================================================================

const { toDate } = require('./helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./state.calculator');
const metrics = require('./metrics.calculator');
const dataProvider = require('./data.provider');

/**
 * 核心計算函式，採用「單一事實來源」架構
 * @param {Array} txs - 用於計算的交易紀錄
 * @param {Array} allUserSplits - 使用者所有的拆股事件
 * @param {Array} allUserDividends - 使用者所有的股利事件
 * @param {string} benchmarkSymbol - 比較基準
 * @param {Object} [baseSnapshot=null] - (可選) 用於增量計算的基礎快照
 * @param {Object} [existingHistory=null] - (可選) 已有的歷史數據
 * @returns {Object} 包含所有計算結果的物件
 */
async function runCalculationEngine(txs, allUserSplits, allUserDividends, benchmarkSymbol, baseSnapshot = null, existingHistory = null) {
    if (txs.length === 0) {
        return {
            summaryData: {},
            holdingsToUpdate: {},
            fullHistory: {},
            twrHistory: {},
            benchmarkHistory: {},
            netProfitHistory: {}
        };
    }
    
    const symbolsInScope = new Set(txs.map(t => t.symbol.toUpperCase()));
    const splitsInScope = allUserSplits.filter(s => symbolsInScope.has(s.symbol.toUpperCase()));
    const dividendsInScope = allUserDividends.filter(d => symbolsInScope.has(d.symbol.toUpperCase()));

    await dataProvider.ensureAllSymbolsData(txs, benchmarkSymbol);
    const market = await dataProvider.getMarketDataFromDb(txs, benchmarkSymbol);

    const { evts, firstBuyDate } = prepareEvents(txs, splitsInScope, market, dividendsInScope);
    if (!firstBuyDate) return {};

    let calculationStartDate = firstBuyDate;
    let oldHistory = {};

    if (baseSnapshot && existingHistory) {
        console.log(`[Engine] 使用基準快照: ${baseSnapshot.snapshot_date}`);
        const snapshotDate = toDate(baseSnapshot.snapshot_date);
        oldHistory = existingHistory;
        Object.keys(oldHistory).forEach(date => { if (toDate(date) > snapshotDate) delete oldHistory[date]; });
        const nextDay = new Date(snapshotDate);
        nextDay.setDate(nextDay.getDate() + 1);
        calculationStartDate = nextDay;
    }

    const partialHistory = {};
    const todayForCalc = new Date();
    todayForCalc.setUTCHours(0, 0, 0, 0);
    let curDate = new Date(calculationStartDate);
    while (curDate <= todayForCalc) {
        const dateStr = curDate.toISOString().split('T')[0];
        partialHistory[dateStr] = dailyValue(getPortfolioStateOnDate(evts, curDate, market), market, curDate, evts);
        curDate.setDate(curDate.getDate() + 1);
    }
    const fullHistory = { ...oldHistory, ...partialHistory };

    const dailyCashflows = metrics.calculateDailyCashflows(evts, market);
    const { twrHistory, benchmarkHistory } = metrics.calculateTwrHistory(fullHistory, evts, market, benchmarkSymbol, firstBuyDate, dailyCashflows);
    
    // ========================= 【核心修改 - 開始】 =========================
    // == 統一計算邏輯的核心實現
    // =========================================================================================

    // 步驟 1: 確立權威的「總利潤」歷史 (`netProfitHistory`)
    const netProfitHistory = {};
    let cumulativeNetProfit = 0;
    const sortedDates = Object.keys(fullHistory).sort();
    
    if (sortedDates.length > 0) {
        const firstDateInScope = toDate(sortedDates[0]);
        const dayBeforeFirst = new Date(firstDateInScope);
        dayBeforeFirst.setDate(dayBeforeFirst.getDate() - 1);
        
        // 如果是增量計算，嘗試從舊歷史中獲取基線淨利
        const dayBeforeFirstStr = dayBeforeFirst.toISOString().split('T')[0];
        cumulativeNetProfit = existingHistory ? (existingHistory[dayBeforeFirstStr] || 0) : 0;
    
        for (const dateStr of sortedDates) {
            const today = toDate(dateStr);
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);

            const dailyPL = metrics.calculateDailyPL(today, yesterday, evts, market);
            cumulativeNetProfit += dailyPL;
            netProfitHistory[dateStr] = cumulativeNetProfit;
        }
    }

    // 步驟 2: 計算準確的「未實現損益」和其他核心指標
    const portfolioResult = metrics.calculateCoreMetrics(evts, market);
    const { holdingsToUpdate, totalUnrealizedPL, totalBuyCostTWD, xirr } = portfolioResult;

    // 步驟 3: 推導出唯一的「已實現損益」
    const totalProfit = netProfitHistory[sortedDates[sortedDates.length - 1]] || 0;
    const totalRealizedPL = totalProfit - totalUnrealizedPL;

    // 步驟 4: 組合最終的 summaryData
    const overallReturnRate = totalBuyCostTWD > 0 ? (totalProfit / totalBuyCostTWD) * 100 : 0;

    const summaryData = {
        totalRealizedPL: totalRealizedPL, // 使用推導出的值
        xirr: xirr,
        overallReturnRate: overallReturnRate, // 使用基於權威總利潤計算的值
        benchmarkSymbol: benchmarkSymbol
    };
    // ========================= 【核心修改 - 結束】 =========================

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
