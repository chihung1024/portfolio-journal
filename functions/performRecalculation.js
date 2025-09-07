// 引入 D1 Client，這是與 Cloudflare D1 資料庫互動的介面。
const { D1 } = require("../d1.client");
// 引入 StateCalculator，這是計算特定日期資產狀態（如持股數）的核心模組。
const { StateCalculator } = require("./calculation/state.calculator");
// 引入 toDate 輔助函式，用於將日期標準化為 UTC午夜零時，以避免時區問題。
const { toDate } = require("./calculation/helpers");

/**
 * 為指定使用者計算並快取所有待確認的配息。
 *
 * 此函式的核心邏輯是找出使用者在「除息日的前一天」所持有的股票部位，
 * 並根據當時的持股數量與每股股息，計算出預期的配息金額。
 * 最終，計算結果將被儲存（或更新）到 `user_pending_dividends` 資料表中。
 *
 * @param {string} userId 要計算配息的使用者 ID。
 * @param {D1} d1 D1 Client 的實例，用於執行資料庫操作。
 */
const calculateAndCachePendingDividends = async (userId, d1) => {
  // 步驟 1: 獲取該使用者的所有交易紀錄。
  const transactions = await d1.getTransactions(userId);
  if (transactions.length === 0) {
    console.log(`No transactions found for user ${userId}. Skipping pending dividend calculation.`);
    return;
  }

  // 步驟 2: 獲取市場上所有股票的歷史配息日曆。
  const dividendHistory = await d1.getDividendHistory();
  if (dividendHistory.length === 0) {
    console.log("No dividend history found. Skipping pending dividend calculation.");
    return;
  }

  // 步驟 3: 獲取該使用者已存在的待確認配息，用於避免重複處理。
  const existingPendingDividends = await d1.getPendingDividends(userId);
  const existingKeys = new Set(
    existingPendingDividends.map((d) => `${d.symbol}:${d.ex_date}`)
  );

  // 為提升查找效率，將交易紀錄按股票代碼進行分組。
  const transactionsBySymbol = transactions.reduce((acc, tx) => {
    if (!acc[tx.symbol]) {
      acc[tx.symbol] = [];
    }
    acc[tx.symbol].push(tx);
    return acc;
  }, {});

  const pendingDividendsToInsert = [];

  // 步驟 4: 遍歷市場上的每一筆歷史配息紀錄。
  for (const dividend of dividendHistory) {
    const { symbol, ex_date: exDateStr, dividend: dividend_amount } = dividend;
    const key = `${symbol}:${exDateStr}`;

    if (existingKeys.has(key)) {
      continue;
    }

    const userTransactionsForSymbol = transactionsBySymbol[symbol];
    if (!userTransactionsForforSymbol || userTransactionsForSymbol.length === 0) {
      continue;
    }

    // --- 關鍵修正處 (版本一) ---
    // 使用 `toDate` 函式將日期字串標準化為 UTC 午夜零時的 Date 物件，避免時區問題。
    const exDate = toDate(exDateStr);
    const dateBeforeExDate = new Date(exDate.getTime() - 24 * 60 * 60 * 1000);

    const state = new StateCalculator(userTransactionsForSymbol).getStateAtDate(
      dateBeforeExDate
    );

    if (state.shares > 0) {
      pendingDividendsToInsert.push({
        user_id: userId,
        symbol,
        ex_date: exDateStr,
        shares_on_ex_date: state.shares,
        dividend_amount,
        total_dividend: state.shares * dividend_amount,
        status: "pending",
      });
    }
  }

  // 步驟 5: 如果有計算出新的待確認配息，則使用批次操作一次性將它們全部寫入資料庫。
  if (pendingDividendsToInsert.length > 0) {
    // 在寫入新資料前，先清除舊的待確認配息，確保資料永遠是最新狀態。
    await d1.clearPendingDividends(userId);
    console.log(`Cleared existing pending dividends for user ${userId}.`);
    console.log(`Inserting ${pendingDividendsToInsert.length} new pending dividends for user ${userId}.`);
    await d1.insertPendingDividends(pendingDividendsToInsert);
  } else {
    // 即使沒有新的，也應該清除舊的，因為可能持股已賣出。
    await d1.clearPendingDividends(userId);
    console.log(`No new pending dividends to insert for user ${userId}, cleared existing ones.`);
  }
};

/**
 * 對指定使用者的投資組合數據進行全面的重新計算與快取。
 *
 * @param {string} userId 要進行重算的使用者 ID。
 * @param {D1} d1 D1 Client 的實例。
 * @param {boolean} [isIncremental=false] 是否執行增量更新。
 * `false` (預設): 完整重算，會清空所有快取，適用於手動觸發或重大變更。
 * `true`: 增量更新，僅更新必要數據，適用於單筆交易變更，效能較好。
 */
const performRecalculation = async (userId, d1, isIncremental = false) => {
  console.log(`Starting recalculation for user ${userId} (Incremental: ${isIncremental})...`);

  const transactions = await d1.getTransactions(userId);

  if (!transactions || transactions.length === 0) {
    console.log(`User ${userId} has no transactions. Clearing all cached data.`);
    await d1.clearAllUserCache(userId);
    return;
  }

  const calculationEngine = new (require("./calculation/engine"))(transactions);

  if (isIncremental) {
    // --- 增量更新路徑 ---
    // 在此路徑中，我們只更新會受交易變動影響的數據，不清空歷史狀態。
    console.log(`Performing incremental update for user ${userId}.`);
    
    // 重新計算並快取當前持股與已實現損益。
    const { states } = calculationEngine.calculateHistoricalStates(); // 增量更新也需要最新的狀態來計算持股
    const { holdings } = calculationEngine.calculateHoldings(states[states.length - 1]);
    await d1.clearHoldings(userId);
    await d1.insertHoldings(userId, Object.values(holdings));
    console.log(`Incrementally updated ${Object.values(holdings).length} holding records.`);

    const { closedPositions } = calculationEngine.calculateClosedPositions();
    await d1.clearClosedPositions(userId);
    await d1.insertClosedPositions(userId, closedPositions);
    console.log(`Incrementally updated ${closedPositions.length} closed position records.`);

  } else {
    // --- 完整重算路徑 ---
    console.log(`Performing full recalculation for user ${userId}.`);
    
    // 步驟 1: 清空所有舊快取。
    await d1.clearAllUserCache(userId);
    console.log(`Cleared existing cache for user ${userId}.`);

    // 步驟 2: 計算並快取歷史每日資產快照。
    const { states } = calculationEngine.calculateHistoricalStates();
    await d1.insertStates(userId, states);
    console.log(`Inserted ${states.length} state records for user ${userId}.`);

    // 步驟 3: 計算並快取當前持股。
    const { holdings } = calculationEngine.calculateHoldings(states[states.length - 1]);
    await d1.insertHoldings(userId, Object.values(holdings));
    console.log(`Inserted ${Object.values(holdings).length} holding records.`);

    // 步驟 4: 計算並快取已實現損益。
    const { closedPositions } = calculationEngine.calculateClosedPositions();
    await d1.insertClosedPositions(userId, closedPositions);
    console.log(`Inserted ${closedPositions.length} closed position records.`);
  }

  // --- 關鍵修正處 (版本二) ---
  // 【根本原因】無論是完整重算還是增量更新，都必須重新計算待確認配息。
  // 【修正】將此函式呼叫移至 if/else 邏輯塊之外，確保它在兩種路徑下都會被執行。
  await calculateAndCachePendingDividends(userId, d1);

  console.log(`Recalculation finished successfully for user ${userId}.`);
};

// 導出模組，供系統的其他部分（如 API 端點）調用。
module.exports = {
  performRecalculation,
  calculateAndCachePendingDividends,
};
