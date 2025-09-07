// 引入 D1 Client，這是與 Cloudflare D1 資料庫互動的介面。
const { D1 } = require("../d1.client");
// 引入 StateCalculator，這是計算特定日期資產狀態（如持股數）的核心模組。
const { StateCalculator } = require("./calculation/state.calculator");
// 引入 toDate 輔助函式，用於將日期標準化為 UTC午夜零時，以避免時區問題。
const { toDate } = require("./calculation/helpers");

/**
 * 為指定使用者計算並快取所有待確認的配息。
 *
 * @param {string} userId 要計算配息的使用者 ID。
 * @param {D1} d1 D1 Client 的實例，用於執行資料庫操作。
 */
const calculateAndCachePendingDividends = async (userId, d1) => {
  const transactions = await d1.getTransactions(userId);
  if (transactions.length === 0) {
    console.log(`No transactions for user ${userId}, clearing pending dividends.`);
    await d1.clearPendingDividends(userId);
    return;
  }

  const dividendHistory = await d1.getDividendHistory();
  if (dividendHistory.length === 0) {
    console.log("No dividend history found. Skipping pending dividend calculation.");
    return;
  }

  const transactionsBySymbol = transactions.reduce((acc, tx) => {
    if (!acc[tx.symbol]) {
      acc[tx.symbol] = [];
    }
    acc[tx.symbol].push(tx);
    return acc;
  }, {});

  const pendingDividendsToInsert = [];

  for (const dividend of dividendHistory) {
    const { symbol, ex_date: exDateStr, dividend: dividend_amount } = dividend;
    const userTransactionsForSymbol = transactionsBySymbol[symbol];

    if (!userTransactionsForSymbol || userTransactionsForSymbol.length === 0) {
      continue;
    }

    const exDate = toDate(exDateStr);
    const dateBeforeExDate = new Date(exDate.getTime() - 24 * 60 * 60 * 1000);

    const state = new StateCalculator(userTransactionsForSymbol).getStateAtDate(dateBeforeExDate);

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

  // **核心邏輯**：先清除所有舊的待確認配息，再插入新計算出的結果。
  // 這確保了數據的絕對一致性（例如，賣出持股後，舊的待確認配息會被正確移除）。
  await d1.clearPendingDividends(userId);

  if (pendingDividendsToInsert.length > 0) {
    console.log(`Inserting ${pendingDividendsToInsert.length} new pending dividends for user ${userId}.`);
    await d1.insertPendingDividends(pendingDividendsToInsert);
  } else {
    console.log(`No new pending dividends to insert for user ${userId}.`);
  }
};

/**
 * 對指定使用者的投資組合數據進行全面的重新計算與快取。
 *
 * @param {string} userId 要進行重算的使用者 ID。
 * @param {D1} d1 D1 Client 的實例。
 * @param {boolean} [isIncremental=false] 是否執行增量更新。
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
  const { states } = calculationEngine.calculateHistoricalStates();

  if (isIncremental && states.length > 0) {
    console.log(`Performing incremental update for user ${userId}.`);
    
    const { holdings } = calculationEngine.calculateHoldings(states[states.length - 1]);
    await d1.clearHoldings(userId);
    await d1.insertHoldings(userId, Object.values(holdings));
    
    const { closedPositions } = calculationEngine.calculateClosedPositions();
    await d1.clearClosedPositions(userId);
    await d1.insertClosedPositions(userId, closedPositions);

  } else {
    console.log(`Performing full recalculation for user ${userId}.`);
    await d1.clearAllUserCache(userId);

    await d1.insertStates(userId, states);
    
    if (states.length > 0) {
        const { holdings } = calculationEngine.calculateHoldings(states[states.length - 1]);
        await d1.insertHoldings(userId, Object.values(holdings));
    }
    
    const { closedPositions } = calculationEngine.calculateClosedPositions();
    await d1.insertClosedPositions(userId, closedPositions);
  }

  // **最終修正**：無論是何種路徑，都在所有其他計算完成後，最後執行配息計算。
  // 這次呼叫是安全的，因為 d1.client.js 中已存在 clearPendingDividends 方法。
  await calculateAndCachePendingDividends(userId, d1);

  console.log(`Recalculation finished successfully for user ${userId}.`);
};

module.exports = {
  performRecalculation,
  calculateAndCachePendingDividends,
};
