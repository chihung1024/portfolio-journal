// =========================================================================================
// == 檔案：functions/calculation/engine.js (v2.0 - 升級為通用計算引擎)
// == 職責：純粹的、可重用的投資組合計算引擎，現已整合進階績效指標。
// =========================================================================================

const { toDate, findNearest, findFxRate, isTwStock } = require('./helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./state.calculator');
const metrics = require('./metrics.calculator');
const dataProvider = require('./data.provider');

/**
 * 核心計算引擎函式
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
            netProfitHistory: {},
            performanceMetrics: {} // [新增] 回傳空物件
        };
    }

    // --- 1. 準備數據 (邏輯維持不變) ---
    await dataProvider.ensureAllSymbolsData(txs, benchmarkSymbol);
    const market = await dataProvider.getMarketDataFromDb(txs, benchmarkSymbol);

    // --- 2. 準備事件流 (邏輯維持不變) ---
    const { evts, firstBuyDate } = prepareEvents(txs, splits, market, userDividends);
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

    // --- 3. 計算每日投資組合歷史淨值 (邏輯維持不變) ---
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

    // --- 4. 計算核心指標與圖表數據 (邏輯維持不變) ---
    const dailyCashflows = metrics.calculateDailyCashflows(evts, market);
    const { twrHistory, benchmarkHistory } = metrics.calculateTwrHistory(fullHistory, evts, market, benchmarkSymbol, firstBuyDate, dailyCashflows);
    
    const portfolioResult = metrics.calculateCoreMetrics(evts, market);

    const netProfitHistory = {};
    let cumulativeCashflow = 0;
    Object.keys(fullHistory).sort().forEach(dateStr => {
        cumulativeCashflow += (dailyCashflows[dateStr] || 0);
        netProfitHistory[dateStr] = fullHistory[dateStr] - cumulativeCashflow;
    });

    const { holdingsToUpdate } = portfolioResult.holdings;
    
    // --- 5. [核心升級] 計算進階回測績效指標 ---
    const benchmarkValues = {};
    // 將 benchmarkHistory 的百分比走勢，轉換為基於 100 的淨值走勢，以供 metrics 計算
    Object.entries(benchmarkHistory).forEach(([date, percentage]) => {
        benchmarkValues[date] = 100 * (1 + percentage / 100);
    });
    const performanceMetrics = metrics.calculatePerformanceMetrics(fullHistory, benchmarkValues);

    // --- 6. [核心升級] 組合最終結果 ---
    const summaryData = {
        totalRealizedPL: portfolioResult.totalRealizedPL,
        xirr: portfolioResult.xirr,
        overallReturnRate: portfolioResult.overallReturnRate,
        benchmarkSymbol: benchmarkSymbol,
        ...performanceMetrics // 將所有進階指標 (cagr, mdd, alpha, beta...) 合併到 summary 中
    };

    return {
        summaryData,
        holdingsToUpdate,
        fullHistory,
        twrHistory,
        benchmarkHistory,
        netProfitHistory,
        performanceMetrics, // 也獨立回傳一份，方便未來使用
        evts, 
        market
    };
}

module.exports = { runCalculationEngine };
