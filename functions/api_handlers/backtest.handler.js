// =========================================================================================
// == [新增] 回測 Action 處理模組 (backtest.handler.js) - v1.0
// == 職責：處理所有與策略回測相關的 API Action。
// =========================================================================================

const { z } = require("zod");
const { generateSimulatedEvents } = require('../calculation/simulation');
const { runCalculationEngine } = require('../calculation/engine');

// Zod Schema for input validation
const backtestSchema = z.object({
    portfolioConfig: z.object({
        tickers: z.array(z.string().min(1)),
        weights: z.array(z.number()),
        rebalancingPeriod: z.enum(['never', 'annually', 'quarterly', 'monthly']),
    }),
    initialAmount: z.number().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    benchmarkSymbol: z.string().min(1).optional().default('SPY'),
});


/**
 * 執行一次策略回測
 */
exports.runBacktest = async (uid, data, res) => {
    try {
        // 1. 驗證前端傳入的參數格式
        const { 
            portfolioConfig, 
            initialAmount, 
            startDate, 
            endDate,
            benchmarkSymbol 
        } = backtestSchema.parse(data);

        console.log(`[${uid}] Running backtest for tickers: [${portfolioConfig.tickers.join(', ')}] from ${startDate} to ${endDate}`);

        // 2. 生成模擬事件流
        // 注意：此處我們傳入一個空的 marketData，因為 generateSimulatedEvents 內部會自己從 D1 獲取數據
        // 我們將 txs, splits, userDividends 設為空陣列，因為這是模擬，沒有真實交易
        const simulatedTxs = generateSimulatedEvents(
            portfolioConfig,
            {}, // 傳入空的 marketData，讓 simulation 模組自行處理
            initialAmount,
            new Date(startDate),
            new Date(endDate)
        );

        // 3. 將模擬事件流送入通用計算引擎
        const result = await runCalculationEngine(
            simulatedTxs,
            [], // splits: 模擬中不考慮自定義拆股
            [], // userDividends: 模擬中不考慮自定義股利
            benchmarkSymbol
        );

        // 4. 將計算結果回傳給前端
        return res.status(200).send({
            success: true,
            data: result
        });

    } catch (error) {
        console.error(`[Backtest Handler] Error during backtest for UID ${uid}:`, error);
        if (error instanceof z.ZodError) {
            return res.status(400).send({ success: false, message: "輸入資料格式驗證失敗", errors: error.errors });
        }
        // 回傳一個更友善的錯誤訊息給前端
        return res.status(500).send({ success: false, message: `回測計算時發生錯誤: ${error.message}` });
    }
};
