// =========================================================================================
// == 檔案：functions/calculation/engine.js (v3.0 - Unified P&L Timeline)
// == 職責：純粹的、可重用的投資組合計算引擎，實現以損益時間線為核心的單一事實來源模型。
// =========================================================================================

const { toDate } = require('./helpers');
const { prepareEvents, getPortfolioStateOnDate, dailyValue } = require('./state.calculator');
const metrics = require('./metrics.calculator');
const dataProvider = require('./data.provider');

/**
 * 【核心重構】統一的計算引擎函式
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
            netProfitHistory: {},
            evts: [],
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
    if (!firstBuyDate) return { 
        summaryData: {}, holdingsToUpdate: {}, fullHistory: {}, twrHistory: {}, 
        benchmarkHistory: {}, netProfitHistory: {}, evts: [], market: {} 
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

    const dailyCashflowsForTwr = evts.reduce((acc, e) => {
        const dateStr = toDate(e.date).toISOString().split('T')[0];
        let flow = 0;
        if (e.eventType === 'transaction') {
            const fx = (e.exchangeRate && e.currency !== 'TWD') ? e.exchangeRate : findFxRate(market, e.currency, toDate(e.date));
            flow = (e.type === 'buy' ? 1 : -1) * getTotalCost(e) * (e.currency === 'TWD' ? 1 : fx);
        }
        if (flow !== 0) acc[dateStr] = (acc[dateStr] || 0) + flow;
        return acc;
    }, {});
    
    const { twrHistory, benchmarkHistory } = metrics.calculateTwrHistory(fullHistory, evts, market, benchmarkSymbol, firstBuyDate, dailyCashflowsForTwr);
    
    const portfolioResult = metrics.calculateCoreMetrics(evts, market);

    // ========================= 【核心修改 - 開始】 =========================
    // 建立統一的、正確的淨利時間線 (Single Source of Truth)
    const netProfitHistory = {};
    let cumulativeNetProfit = 0;
    const sortedDates = Object.keys(fullHistory).sort();
    
    if (sortedDates.length > 0) {
        const firstDateInScope = toDate(sortedDates[0]);
        const dayBeforeFirst = new Date(firstDateInScope);
        dayBeforeFirst.setDate(dayBeforeFirst.getDate() - 1);
        
        // 增量計算時，從舊歷史的最後一天繼承累計淨利
        cumulativeNetProfit = (existingHistory && existingHistory[dayBeforeFirst.toISOString().split('T')[0]]) || 0;
    
        for (const dateStr of sortedDates) {
            const today = toDate(dateStr);
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);

            // 使用修正後的 calculateDailyPL 函式
            const dailyPL = metrics.calculateDailyPL(today, yesterday, evts, market);
            cumulativeNetProfit += dailyPL;
            netProfitHistory[dateStr] = cumulativeNetProfit;
        }
    }
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
        netProfitHistory, // 回傳新的、統一的淨利歷史
        evts, 
        market 
    };
}

module.exports = { runCalculationEngine };
