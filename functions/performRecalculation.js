import { createDataProvider } from './calculation/data.provider';
import { CalculationEngine } from './calculation/engine';
import { D1Client } from './d1.client';

/**
 * 重新計算並緩存指定用戶的所有投資組合指標
 * @param {string} userId - 使用者 ID
 * @param {object} env - 環境變數物件 (包含 D1 資料庫綁定)
 */
export async function performRecalculation(userId, env) {
    console.log(`[Recalculation Started] User: ${userId}`);
    const d1 = new D1Client(env.DB);
    const dataProvider = createDataProvider(d1, userId);
    const engine = new CalculationEngine(dataProvider);

    try {
        // 1. 計算並緩存待確認股息
        await calculateAndCachePendingDividends(dataProvider, d1, userId);
        console.log(`[Recalculation Step] Cached pending dividends for user: ${userId}`);

        // 2. 獲取所有持股
        const holdings = await dataProvider.getHoldings();
        if (!holdings || holdings.length === 0) {
            console.log(`[Recalculation] No holdings found for user: ${userId}. Clearing old data.`);
            await d1.clearUserCache(userId, ['user_metrics', 'user_closed_positions']);
            console.log(`[Recalculation Finished] User: ${userId}. No holdings, process complete.`);
            return;
        }
        console.log(`[Recalculation Step] Found ${holdings.length} holdings for user: ${userId}`);

        // 3. 計算並緩存核心指標
        const metrics = await engine.calculateMetrics(holdings);
        await d1.updateUserMetrics(userId, metrics);
        console.log(`[Recalculation Step] Cached core metrics for user: ${userId}`);

        // 4. 計算並緩存已平倉部位
        const closedPositions = await engine.calculateClosedPositions(holdings);
        await d1.updateUserClosedPositions(userId, closedPositions);
        console.log(`[Recalculation Step] Cached ${closedPositions.length} closed positions for user: ${userId}`);

        console.log(`[Recalculation Finished] Successfully completed for user: ${userId}`);
    } catch (error) {
        console.error(`[Recalculation Failed] An error occurred for user ${userId}:`, error);
        // 在生產環境中，您可能希望加入更詳細的錯誤處理或重試機制
        throw error; // 重新拋出錯誤，以便上層呼叫者知道發生了問題
    }
}

/**
 * 計算並緩存用戶的待確認股息
 * @param {object} dataProvider - 數據提供者實例
 * @param {D1Client} d1 - D1 Client 實例
 * @param {string} userId - 使用者 ID
 */
async function calculateAndCachePendingDividends(dataProvider, d1, userId) {
    const holdings = await dataProvider.getHoldings(false); // 獲取包含已平倉的全部持股
    const pendingDividends = [];

    for (const holding of holdings) {
        const officialDividends = await dataProvider.getDividendHistory(holding.symbol);
        const userDividends = await dataProvider.getUserDividends(holding.symbol);

        for (const officialDividend of officialDividends) {
            const exDate = new Date(officialDividend.exDate);

            // 檢查此官方股息是否已被用戶確認
            const isConfirmed = userDividends.some(
                (d) => new Date(d.exDate).getTime() === exDate.getTime() && d.symbol === holding.symbol
            );
            
            // 【可維護性提升 - 增加日誌】
            // 為每筆股息的資格審查流程增加結構化日誌，方便未來追蹤問題。
            // 日誌清晰地記錄了判斷流程：股票代號、除息日、是否已確認、當日持股數及最終決定。
            console.log(`[Pending Dividend Check] User: ${userId}, Symbol: ${holding.symbol}, ExDate: ${officialDividend.exDate}`);

            if (isConfirmed) {
                console.log(` -> Status: Confirmed by user. Skipping.`);
                continue;
            }

            // 使用 dataProvider 來計算除息日的持股數
            const sharesOnExDate = dataProvider.calculateSharesOnDate(holding.symbol, exDate);
            console.log(` -> Shares on Ex-Date: ${sharesOnExDate}`);

            if (sharesOnExDate > 0) {
                const pendingDividend = {
                    symbol: holding.symbol,
                    exDate: officialDividend.exDate,
                    paymentDate: officialDividend.paymentDate,
                    amount: officialDividend.amount,
                    shares: sharesOnExDate,
                    totalAmount: sharesOnExDate * officialDividend.amount,
                };
                pendingDividends.push(pendingDividend);
                console.log(` -> Status: Eligible. Added to pending list with ${sharesOnExDate} shares.`);
            } else {
                console.log(` -> Status: Not eligible (0 shares). Skipping.`);
            }
        }
    }

    // 更新資料庫前先清除舊的待確認股息
    await d1.clearUserPendingDividends(userId);
    // 如果有新的待確認股息，則插入資料庫
    if (pendingDividends.length > 0) {
        await d1.insertUserPendingDividends(userId, pendingDividends);
    }
    console.log(`[Pending Dividend Update] User: ${userId}. Cleared old and cached ${pendingDividends.length} new pending dividends.`);
}
