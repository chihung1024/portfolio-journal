// A simple D1 client for interacting with the Cloudflare D1 database.
class D1 {
  constructor(db) {
    this.db = db;
  }

  // Generic query method
  async query(sql, params = []) {
    const stmt = this.db.prepare(sql).bind(...params);
    return await stmt.all();
  }

  // Generic execute method for INSERT, UPDATE, DELETE
  async execute(sql, params = []) {
    const stmt = this.db.prepare(sql).bind(...params);
    return await stmt.run();
  }

  // Get all transactions for a user
  async getTransactions(userId) {
    const { results } = await this.db
      .prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY date ASC, id ASC")
      .bind(userId)
      .all();
    return results;
  }

  // Insert a single transaction
  async insertTransaction(userId, tx) {
    const { user_id, symbol, type, date, shares, price, amount, currency, notes } = tx;
    const stmt = this.db.prepare(
      "INSERT INTO transactions (user_id, symbol, type, date, shares, price, amount, currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const { meta } = await stmt.bind(user_id, symbol, type, date, shares, price, amount, currency, notes).run();
    return meta.last_row_id;
  }
  
  // Update an existing transaction
  async updateTransaction(userId, txId, tx) {
	const { symbol, type, date, shares, price, amount, currency, notes } = tx;
	const stmt = this.db.prepare(
	  "UPDATE transactions SET symbol = ?, type = ?, date = ?, shares = ?, price = ?, amount = ?, currency = ?, notes = ? WHERE id = ? AND user_id = ?"
	);
	return await stmt.bind(symbol, type, date, shares, price, amount, currency, notes, txId, userId).run();
  }

  // Delete a transaction
  async deleteTransaction(userId, txId) {
    const stmt = this.db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?");
    return await stmt.bind(txId, userId).run();
  }
  
  // Get all dividend history
  async getDividendHistory() {
	const { results } = await this.db.prepare("SELECT * FROM dividend_history").all();
	return results;
  }

  // Get existing pending dividends
  async getPendingDividends(userId) {
    const { results } = await this.db
      .prepare("SELECT * FROM user_pending_dividends WHERE user_id = ?")
      .bind(userId)
      .all();
    return results;
  }
  
  // Get a single pending dividend by ID
  async getPendingDividendById(id, userId) {
    const stmt = this.db.prepare("SELECT * FROM user_pending_dividends WHERE id = ? AND user_id = ?");
    return await stmt.bind(id, userId).first();
  }
  
  // Get confirmed dividends
  async getConfirmedDividends(userId) {
    const { results } = await this.db
      .prepare(`
          SELECT 
              upd.id,
              upd.symbol,
              upd.ex_date,
              upd.shares_on_ex_date,
              t.amount as total_dividend,
              upd.transaction_id
          FROM 
              user_pending_dividends upd
          JOIN 
              transactions t ON upd.transaction_id = t.id
          WHERE 
              upd.user_id = ? AND upd.status = 'confirmed'
          ORDER BY
              t.date DESC
      `)
      .bind(userId)
      .all();
    return results;
}


  // Batch insert pending dividends
  async insertPendingDividends(dividends) {
    if (dividends.length === 0) return;
    const stmt = this.db.prepare(
      "INSERT INTO user_pending_dividends (user_id, symbol, ex_date, shares_on_ex_date, dividend_amount, total_dividend, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const batch = dividends.map((d) =>
      stmt.bind(d.user_id, d.symbol, d.ex_date, d.shares_on_ex_date, d.dividend_amount, d.total_dividend, d.status)
    );
    return await this.db.batch(batch);
  }
  
  // Update a pending dividend status
  async updatePendingDividendStatus(id, userId, status, transactionId = null) {
    const stmt = this.db.prepare(
      "UPDATE user_pending_dividends SET status = ?, transaction_id = ? WHERE id = ? AND user_id = ?"
    );
    return await stmt.bind(status, transactionId, id, userId).run();
  }

  // Insert historical states
  async insertStates(userId, states) {
    if (states.length === 0) return;
    const stmt = this.db.prepare(
      "INSERT INTO user_portfolio_history (user_id, date, total_value, cost_basis, net_profit, twr) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const batch = states.map((s) =>
      stmt.bind(userId, s.date, s.totalValue, s.costBasis, s.netProfit, s.twr)
    );
    return await this.db.batch(batch);
  }

  // Insert current holdings
  async insertHoldings(userId, holdings) {
    if (holdings.length === 0) return;
    const stmt = this.db.prepare(
      "INSERT INTO user_holdings (user_id, symbol, shares, cost_basis, average_price, market_value, unrealized_pnl, unrealized_pnl_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const batch = holdings.map((h) =>
      stmt.bind(
        userId,
        h.symbol,
        h.shares,
        h.costBasis,
        h.averagePrice,
        h.marketValue,
        h.unrealizedPnl,
        h.unrealizedPnlPercent
      )
    );
    return await this.db.batch(batch);
  }

  // Insert closed positions
  async insertClosedPositions(userId, positions) {
    if (positions.length === 0) return;
    const stmt = this.db.prepare(
      "INSERT INTO user_closed_positions (user_id, symbol, total_shares, total_proceeds, total_cost, realized_pnl, open_date, close_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const batch = positions.map((p) =>
      stmt.bind(
        userId,
        p.symbol,
        p.totalShares,
        p.totalProceeds,
        p.totalCost,
        p.realizedPnl,
        p.openDate,
        p.closeDate
      )
    );
    return await this.db.batch(batch);
  }

  // Clear all cached data for a user
  async clearAllUserCache(userId) {
    await this.clearStates(userId);
    await this.clearHoldings(userId);
    await this.clearClosedPositions(userId);
    await this.clearPendingDividends(userId);
  }

  async clearStates(userId) {
    const stmt = this.db.prepare("DELETE FROM user_portfolio_history WHERE user_id = ?");
    return await stmt.bind(userId).run();
  }

  async clearHoldings(userId) {
    const stmt = this.db.prepare("DELETE FROM user_holdings WHERE user_id = ?");
    return await stmt.bind(userId).run();
  }

  async clearClosedPositions(userId) {
    const stmt = this.db.prepare("DELETE FROM user_closed_positions WHERE user_id = ?");
    return await stmt.bind(userId).run();
  }

  /**
   * Clears all pending dividends for a specific user.
   * This is part of the cache clearing process before a recalculation.
   * @param {string} userId The ID of the user.
   * @returns {Promise<any>}
   */
  async clearPendingDividends(userId) {
    const stmt = this.db.prepare("DELETE FROM user_pending_dividends WHERE user_id = ?");
    return await stmt.bind(userId).run();
  }
}

module.exports = {
  D1,
};
