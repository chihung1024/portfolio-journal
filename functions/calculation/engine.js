// =========================================================================================
// == 檔案：functions/calculation/engine.js (v2.2 - Net Profit Baseline Fix)
// == 職責：純粹的、可重用的投資組合計算引擎
// =========================================================================================

const { toDate, findNearest, findFxRate, isTwStock } = require('./helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./state.calculator');
const metrics = require('./metrics.calculator');
const dataProvider = require('./data.provider');

/**
 * 核心計算函式
 * @param {Array} txs - 用於計算的交易紀錄
 * @param {Array} allUserSplits - 使用者所有的拆股事件
 * @param {Array} allUserDividends - 使用者所有的股利事件
 * @param {string} benchmarkSymbol - 比較基準
 * @param {Object} [baseSnapshot=null] - (可選) 用於增量計算的基礎快照
 * @param {Object} [existingHistory=null] - (可選) 已有的市值歷史數據
 * @param {Object} [existingNetProfitHistory=null] - 【新增】(可選) 已有的淨利歷史數據
 * @returns {Object} 包含所有計算結果的物件
 */
async function runCalculationEngine(txs, allUserSplits, allUserDividends, benchmarkSymbol, baseSnapshot = null, existingHistory = null, existingNetProfitHistory = null) {
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


    // 確保計算所需的市場數據都存在
    await dataProvider.ensureAllSymbolsData(txs, benchmarkSymbol);
    const market = await dataProvider.getMarketDataFromDb(txs, benchmarkSymbol);

    const { evts, firstBuyDate } = prepareEvents(txs, splitsInScope, market, dividendsInScope);
    if (!firstBuyDate) return {}; // 如果沒有任何買入事件，無法計算

    let calculationStartDate = firstBuyDate;
    let oldHistory = {};
    let oldNetProfitHistory = {}; // 【新增】為淨利歷史建立舊數據容器

    if (baseSnapshot && existingHistory) {
        console.log(`[Engine] 使用基準快照: ${baseSnapshot.snapshot_date}`);
        const snapshotDate = toDate(baseSnapshot.snapshot_date);
        
        // 處理舊的市值歷史
        oldHistory = existingHistory;
        Object.keys(oldHistory).forEach(date => { if (toDate(date) > snapshotDate) delete oldHistory[date]; });
        
        // 【新增】處理舊的淨利歷史
        if (existingNetProfitHistory) {
            oldNetProfitHistory = existingNetProfitHistory;
            Object.keys(oldNetProfitHistory).forEach(date => { if (toDate(date) > snapshotDate) delete oldNetProfitHistory[date]; });
        }

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
    
    const portfolioResult = metrics.calculateCoreMetrics(evts, market);

    // ========================= 【核心修改 - 開始】 =========================
    const netProfitHistory = {};
    let cumulativeNetProfit = 0;
    const sortedDates = Object.keys(partialHistory).sort();
    
    if (sortedDates.length > 0) {
        const firstDateInScope = toDate(sortedDates[0]);
        const dayBeforeFirst = new Date(firstDateInScope);
        dayBeforeFirst.setDate(dayBeforeFirst.getDate() - 1);
        const dayBeforeFirstStr = dayBeforeFirst.toISOString().split('T')[0];
        
        // 【修正】優先從傳入的 oldNetProfitHistory 獲取基線淨利，若無則為 0
        cumulativeNetProfit = oldNetProfitHistory[dayBeforeFirstStr] || 0;
    
        for (const dateStr of sortedDates) {
            const today = toDate(dateStr);
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);

            const dailyPL = metrics.calculateDailyPL(today, yesterday, evts, market);
            cumulativeNetProfit += dailyPL;
            netProfitHistory[dateStr] = cumulativeNetProfit;
        }
    }
    
    const fullNetProfitHistory = { ...oldNetProfitHistory, ...netProfitHistory };
    // ========================= 【核心修改 - 結束】 =========================


    const { holdingsToUpdate } = portfolioResult.holdings;
    
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
        netProfitHistory: fullNetProfitHistory, // 【修正】回傳合併後的完整淨利歷史
        evts, 
        market 
    };
}

module.exports = { runCalculationEngine };
