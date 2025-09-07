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
  // 如果使用者沒有任何交易紀錄，則沒有持股，直接跳過後續計算。
  if (transactions.length === 0) {
    console.log(`No transactions found for user ${userId}. Skipping pending dividend calculation.`);
    return;
  }

  // 步驟 2: 獲取市場上所有股票的歷史配息日曆。
  const dividendHistory = await d1.getDividendHistory();
  // 如果系統中沒有任何配息資料，也無法進行計算。
  if (dividendHistory.length === 0) {
    console.log("No dividend history found. Skipping pending dividend calculation.");
    return;
  }

  // 步驟 3: 獲取該使用者已存在的待確認配息，用於避免重複處理。
  // 建立一個 Set 結構，方便後續進行快速查找。
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

  // 準備一個陣列，用於存放新計算出的待確認配息。
  const pendingDividendsToInsert = [];

  // 步驟 4: 遍歷市場上的每一筆歷史配息紀錄。
  for (const dividend of dividendHistory) {
    const { symbol, ex_date: exDateStr, dividend: dividend_amount } = dividend;
    const key = `${symbol}:${exDateStr}`;

    // 如果這筆配息已經存在於使用者的待確認清單中，則跳過，不重複計算。
    if (existingKeys.has(key)) {
      continue;
    }

    // 找出該使用者是否交易過這支股票。若無，則不可能持有，直接跳到下一筆。
    const userTransactionsForSymbol = transactionsBySymbol[symbol];
    if (!userTransactionsForSymbol || userTransactionsForSymbol.length === 0) {
      continue;
    }

    // --- 關鍵修正處 ---
    // 計算除息日的前一天。這是判斷是否有權獲得配息的基準日。
    // 【修正】使用 `toDate` 函式將日期字串標準化為 UTC 午夜零時的 Date 物件。
    // 【原因】直接使用 `new Date(exDateStr)` 會受到伺服器時區的影響，可能導致日期判斷錯誤。
    //         例如，在 UTC+8 環境下，`new Date('2025-09-10')` 可能會被解析為 `2025-09-09T16:00:00.000Z`，
    //         這會導致後續與交易日的比較出現偏差。`toDate` 確保了比較的基準是一致的。
    const exDate = toDate(exDateStr);
    const dateBeforeExDate = new Date(exDate.getTime() - 24 * 60 * 60 * 1000);

    // 傳入該股票的所有交易紀錄，並計算出在「除息日前一天」的持股狀態。
    const state = new StateCalculator(userTransactionsForSymbol).getStateAtDate(
      dateBeforeExDate
    );

    // 如果在除息日前一天，使用者的持股數量大於 0，代表他有權領取這次配息。
    if (state.shares > 0) {
      // 建立一筆新的待確認配息紀錄。
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
  // 批次操作可以顯著提升資料庫寫入效能。
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
 * 這是系統中的核心調度函式。當使用者的交易資料發生任何變動（新增、修改、刪除交易）時，
 * 都應觸發此函式，以確保所有衍生數據（如歷史資產快照、當前持股、已實現損益、待確認配息等）
 * 都得到更新，並快取到資料庫中，供前端快速讀取。
 *
 * @param {string} userId 要進行重算的使用者 ID。
 * @param {D1} d1 D1 Client 的實例，用於執行資料庫操作。
 */
const performRecalculation = async (userId, d1) => {
  console.log(`Starting recalculation for user ${userId}...`);

  // 獲取使用者所有的交易紀錄作為計算的基礎。
  const transactions = await d1.getTransactions(userId);

  // 如果使用者沒有任何交易，清空其所有快取資料並提前結束。
  if (!transactions || transactions.length === 0) {
    console.log(`User ${userId} has no transactions. Clearing all cached data.`);
    await d1.clearAllUserCache(userId);
    return;
  }

  // 初始化計算引擎，傳入所有交易紀錄。
  const calculationEngine = new (require("./calculation/engine"))(transactions);

  // 步驟 1: 在開始新的計算之前，先清空該使用者所有舊的快取數據。
  // 這確保了數據的最終一致性，避免舊數據殘留。
  await d1.clearAllUserCache(userId);
  console.log(`Cleared existing cache for user ${userId}.`);

  // 步驟 2: 計算並快取歷史的每日資產狀態（快照）。
  // 這是後續許多圖表與數據分析的基礎。
  const { states } = calculationEngine.calculateHistoricalStates();
  await d1.insertStates(userId, states);
  console.log(`Inserted ${states.length} state records for user ${userId}.`);

  // 步驟 3: 根據最新的資產狀態，計算並快取當前的持股部位。
  const { holdings } = calculationEngine.calculateHoldings(states[states.length - 1]);
  await d1.insertHoldings(userId, Object.values(holdings));
  console.log(`Inserted ${Object.values(holdings).length} holding records for user ${userId}.`);

  // 步驟 4: 計算並快取所有已實現的損益（平倉紀錄）。
  const { closedPositions } = calculationEngine.calculateClosedPositions();
  await d1.insertClosedPositions(userId, closedPositions);
  console.log(`Inserted ${closedPositions.length} closed position records for user ${userId}.`);

  // 步驟 5: 最後，呼叫獨立的函式來計算並快取待確認的配息。
  await calculateAndCachePendingDividends(userId, d1);

  console.log(`Recalculation finished successfully for user ${userId}.`);
};

// 導出模組，供系統的其他部分（如 API 端點）調用。
module.exports = {
  performRecalculation,
  calculateAndCachePendingDividends,
};
