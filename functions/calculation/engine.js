// =========================================================================================
// == 檔案：functions/calculation/engine.js (v2.1 - Purity Refined & Corrected)
// == 職責：純粹的、可重用的投資組合計算引擎
// =========================================================================================

const { toDate, findNearest, findFxRate, isTwStock } = require('./helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./state.calculator');
const metrics = require('./metrics.calculator');
const dataProvider = require('./data.provider');

/**
 * 核心計算函式 (v2.1 - Refactored for Purity)
 * @param {Array} transactions - 【修改】用於計算的、已經被精確過濾的交易紀錄
 * @param {Array} splitsInScope - 【修改】只包含在當前計算範圍內的拆股事件
 * @param {Array} dividendsInScope - 【修改】只包含在當前計算範圍內的股利事件
 * @param {string} benchmarkSymbol - 比較基準
 * @param {Object} [baseSnapshot=null] - (可選) 用於增量計算的基礎快照
 * @param {Object} [existingHistory=null] - (可選) 已有的歷史數據
 * @returns {Object} 包含所有計算結果的物件
 */
async function runCalculationEngine(transactions, splitsInScope, dividendsInScope, benchmarkSymbol, baseSnapshot = null, existingHistory = null) {
    if (transactions.length === 0) {
        return {
            summaryData: {},
            holdingsToUpdate: {},
            fullHistory: {},
            twrHistory: {},
            benchmarkHistory: {},
            netProfitHistory: {},
            evts: [],
            market: {}
        };
    }

    // 確保計算所需的市場數據都存在
    await dataProvider.ensureAllSymbolsData(transactions, benchmarkSymbol);
    const market = await dataProvider.getMarketDataFromDb(transactions, benchmarkSymbol);

    // 【核心修正】現在直接使用由上層傳入的、已經過濾乾淨的數據，消除了數據污染的風險。
    const { evts, firstBuyDate } = prepareEvents(transactions, splitsInScope, market, dividendsInScope);
    if (!firstBuyDate) return {
        summaryData: {},
        holdingsToUpdate: {},
        fullHistory: {},
        twrHistory: {},
        benchmarkHistory: {},
        netProfitHistory: {},
        evts: [],
        market: {}
    };

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
    
    // 呼叫核心指標計算，它現在會回傳包含完整當日損益的持股數據
    const portfolioResult = metrics.calculateCoreMetrics(evts, market);

    const netProfitHistory = {};
    let cumulativeCashflow = 0;
    Object.keys(fullHistory).sort().forEach(dateStr => {
        cumulativeCashflow += (dailyCashflows[dateStr] || 0);
        netProfitHistory[dateStr] = fullHistory[dateStr] - cumulativeCashflow;
    });

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
        netProfitHistory,
        evts,
        market
    };
}

module.exports = { runCalculationEngine };