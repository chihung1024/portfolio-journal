// =========================================================================================
// == 檔案：functions/calculation/engine.js (新增檔案)
// == 職責：純粹的、可重用的投資組合計算引擎
// =========================================================================================

const { toDate, findNearest, findFxRate, isTwStock } = require('./helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./state.calculator');
const metrics = require('./metrics.calculator');
const dataProvider = require('./data.provider');

/**
 * 核心計算函式
 * @param {Array} txs - 用於計算的交易紀錄
 * @param {Array} splits - 用於計算的分割紀錄
 * @param {Array} userDividends - 用於計算的已確認股利
 * @param {string} benchmarkSymbol - 比較基準
 * @param {Object} [baseSnapshot=null] - (可選) 用於增量計算的基礎快照
 * @param {Object} [existingHistory=null] - (可選) 已有的歷史數據
 * @returns {Object} 包含所有計算結果的物件
 */
async function runCalculationEngine(txs, splits, userDividends, benchmarkSymbol, baseSnapshot = null, existingHistory = null) {
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

    // 確保計算所需的市場數據都存在
    await dataProvider.ensureAllSymbolsData(txs, benchmarkSymbol);
    const market = await dataProvider.getMarketDataFromDb(txs, benchmarkSymbol);

    const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);
    if (!firstBuyDate) return {}; // 如果沒有任何買入事件，無法計算

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
        evts, // 回傳 evts 給快照使用
        market // 【修正】將準備好的 market 物件一併回傳
    };
}

module.exports = { runCalculationEngine };
