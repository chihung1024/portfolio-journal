// =========================================================================================
// == 檔案：functions/calculation/engine.js (v5.0 - Architecture Refactor)
// == 描述：v5.0 架構重構，移除引擎中 netProfitHistory 的計算邏輯，為新的快照機制做準備。
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
            // 【v5.0 修改】移除 netProfitHistory
            evts: [], // 回傳空陣列避免後續出錯
            market: {}
        };
    }
    
    const symbolsInScope = new Set(txs.map(t => t.symbol.toUpperCase()));

    const splitsInScope = allUserSplits.filter(s => symbolsInScope.has(s.symbol.toUpperCase()));
    const dividendsInScope = allUserDividends.filter(d => symbolsInScope.has(d.symbol.toUpperCase()));


    // 確保計算所需的市場數據都存在
    await dataProvider.ensureAllSymbolsData(txs, benchmarkSymbol);
    const market = await dataProvider.getMarketDataFromDb(txs, benchmarkSymbol);

    const { evts, firstBuyDate } = prepareEvents(txs, splitsInScope, market, dividendsInScope);
    if (!firstBuyDate) {
        return { // 【v5.0 修改】確保回傳結構一致
            summaryData: {},
            holdingsToUpdate: {},
            fullHistory: {},
            twrHistory: {},
            benchmarkHistory: {},
            evts: [],
            market: {}
        };
    }

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
    
    const portfolioResult = metrics.calculateCoreMetrics(evts, market);

    // ========================= 【v5.0 核心修改 - 開始】 =========================
    // 移除所有 netProfitHistory 的計算邏輯。
    // 這個責任將轉移到 performRecalculation.js 中，它會使用 metrics.calculateDailyPL 來生成快照。
    // ========================= 【v5.0 核心修改 - 結束】 =========================


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
        // 【v5.0 修改】不再回傳 netProfitHistory
        evts, 
        market 
    };
}

module.exports = { runCalculationEngine };
