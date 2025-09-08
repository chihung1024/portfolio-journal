// =========================================================================================
// == 核心計算引擎 (performRecalculation.js) v3.0 - 新增待確認配息生成
// =========================================================================================

const yahooFinance = require('yahoo-finance2').default;
const { d1Client } = require('./d1.client');
const { CalculationEngine } = require('./calculation/engine');

// ========================= 【核心修改 - 開始】 =========================
/**
 * 更新用戶的待確認配息列表
 * 1. 獲取用戶當前持股
 * 2. 查詢 Yahoo Finance 取得即將發放的股利
 * 3. 與現有已確認/待確認股利比對，避免重複
 * 4. 將新發現的股利插入 user_pending_dividends
 * 5. 清理過時的待確認股利
 * @param {string} uid - 使用者 ID
 * @param {CalculationEngine} engine - 已載入交易的計算引擎實例
 */
async function updatePendingDividends(uid, engine) {
    console.log(`[${uid}] 開始更新待確認配息...`);
    try {
        const holdings = engine.getHoldings(new Date().toISOString().split('T')[0]);
        const symbols = Object.keys(holdings);
        if (symbols.length === 0) {
            console.log(`[${uid}] 無持股，跳過待確認配息更新。`);
            return;
        }

        // 步驟 1 & 2: 獲取現有配息記錄和 Yahoo Finance 的數據
        const [existingConfirmed, existingPending, yahooResults] = await Promise.all([
            d1Client.query('SELECT symbol, ex_dividend_date FROM user_dividends WHERE uid = ?', [uid]),
            d1Client.query('SELECT symbol, ex_dividend_date FROM user_pending_dividends WHERE uid = ?', [uid]),
            Promise.allSettled(symbols.map(symbol => yahooFinance.quote(symbol, { fields: ['exDividendDate', 'dividendDate', 'trailingAnnualDividendRate', 'currency'] })))
        ]);

        const existingConfirmedSet = new Set(existingConfirmed.map(d => `${d.symbol}|${d.ex_dividend_date}`));
        const existingPendingSet = new Set(existingPending.map(p => `${p.symbol}|${p.ex_dividend_date}`));

        const newPendingDividends = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 步驟 3: 處理從 Yahoo Finance 獲取的結果
        for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            const result = yahooResults[i];

            if (result.status === 'fulfilled' && result.value && result.value.exDividendDate) {
                const exDividendDate = new Date(result.value.exDividendDate);
                if (exDividendDate >= today) {
                    const exDateStr = exDividendDate.toISOString().split('T')[0];
                    const dividendIdentifier = `${symbol}|${exDateStr}`;

                    // 步驟 4: 檢查是否為新的、不重複的配息
                    if (!existingConfirmedSet.has(dividendIdentifier) && !existingPendingSet.has(dividendIdentifier)) {
                        const quantityAtExDate = engine.getQuantityAtDate(symbol, exDateStr);
                        
                        if (quantityAtExDate > 0) {
                            newPendingDividends.push({
                                sql: 'INSERT INTO user_pending_dividends (uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
                                params: [
                                    uid,
                                    symbol,
                                    exDateStr,
                                    result.value.dividendDate ? new Date(result.value.dividendDate).toISOString().split('T')[0] : exDateStr,
                                    result.value.trailingAnnualDividendRate ? (result.value.trailingAnnualDividendRate / 4).toFixed(6) : 0, // 簡化估算
                                    quantityAtExDate,
                                    result.value.currency || 'USD'
                                ]
                            });
                            // 將新加入的配息也加入 Set，避免同一批次內重複加入
                            existingPendingSet.add(dividendIdentifier);
                        }
                    }
                }
            }
        }

        // 步驟 5: 批次插入新的待確認配息
        if (newPendingDividends.length > 0) {
            await d1Client.batch(newPendingDividends);
            console.log(`[${uid}] 成功插入 ${newPendingDividends.length} 筆新的待確認配息。`);
        } else {
            console.log(`[${uid}] 沒有發現新的待確認配息。`);
        }

        // 步驟 6: 清理一個月前的、仍然待確認的舊配息
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const cleanupDateStr = oneMonthAgo.toISOString().split('T')[0];
        
        const deleteResult = await d1Client.query(
            'DELETE FROM user_pending_dividends WHERE uid = ? AND ex_dividend_date < ?',
            [uid, cleanupDateStr]
        );
        if (deleteResult && deleteResult.changes > 0) {
            console.log(`[${uid}] 成功清理 ${deleteResult.changes} 筆過時的待確認配息。`);
        }

    } catch (error) {
        console.error(`[${uid}] 更新待確認配息時發生錯誤:`, error);
    }
}
// ========================= 【核心修改 - 結束】 =========================


/**
 * 執行完整的後端重新計算
 * @param {string} uid - 使用者 ID
 * @param {string | null} groupId - 可選的群組 ID，如果提供，則只計算該群組
 * @param {boolean} force - 是否強制重新計算，即使快取存在
 * @returns {Promise<object>} - 返回計算結果
 */
async function performRecalculation(uid, groupId = null, force = false) {
    console.log(`[${uid}] [${groupId || 'all'}] [force=${force}] 開始執行後端重算...`);

    const engine = new CalculationEngine(uid);
    let transactions, userSplits;

    // 根據是否有 groupId 決定查詢範圍
    if (groupId) {
        // 1. 檢查群組快取是否有效
        if (!force) {
            const groupCache = await d1Client.queryOne('SELECT cached_data FROM group_cache WHERE group_id = ? AND uid = ?', [groupId, uid]);
            if (groupCache && groupCache.cached_data) {
                try {
                    const parsedCache = JSON.parse(groupCache.cached_data);
                    console.log(`[${uid}] [${groupId}] 群組快取命中，直接回傳快取資料。`);
                    return parsedCache;
                } catch (e) {
                    console.error(`[${uid}] [${groupId}] 解析群組快取失敗，將繼續重算。`, e);
                }
            }
        }
        // 2. 快取無效或強制重算，獲取該群組的交易
        const inclusionRecords = await d1Client.query('SELECT transaction_id FROM group_transaction_inclusions WHERE group_id = ? AND uid = ?', [groupId, uid]);
        const transactionIds = inclusionRecords.map(r => r.transaction_id);

        if (transactionIds.length === 0) {
            return engine.getEmptyResult(); // 如果群組為空，回傳空結果
        }
        
        const placeholders = transactionIds.map(() => '?').join(',');
        [transactions, userSplits] = await Promise.all([
            d1Client.query(`SELECT * FROM transactions WHERE id IN (${placeholders}) AND uid = ? ORDER BY transaction_date ASC`, [...transactionIds, uid]),
            d1Client.query('SELECT * FROM user_splits WHERE uid = ? ORDER BY split_date ASC', [uid])
        ]);

    } else {
        // 無 groupId，獲取用戶所有交易
        [transactions, userSplits] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY transaction_date ASC', [uid]),
            d1Client.query('SELECT * FROM user_splits WHERE uid = ? ORDER BY split_date ASC', [uid])
        ]);
    }

    // 載入數據到計算引擎
    engine.loadData(transactions, userSplits);

    // ========================= 【核心修改 - 開始】 =========================
    // 只有在計算完整投資組合時，才更新待確認配息
    if (!groupId) {
        await updatePendingDividends(uid, engine);
    }
    // ========================= 【核心修改 - 結束】 =========================

    // 執行計算
    const result = engine.calculate();

    // 如果是群組計算，則更新快取
    if (groupId) {
        await d1Client.query(
            'INSERT OR REPLACE INTO group_cache (group_id, uid, cached_data, last_updated) VALUES (?, ?, ?, ?)',
            [groupId, uid, JSON.stringify(result), new Date().toISOString()]
        );
        // 將群組標記為非 dirty
        await d1Client.query('UPDATE groups SET is_dirty = 0 WHERE id = ? AND uid = ?', [groupId, uid]);
        console.log(`[${uid}] [${groupId}] 群組績效已計算並快取。`);
    }

    console.log(`[${uid}] [${groupId || 'all'}] 後端重算完成。`);
    return result;
}

module.exports = { performRecalculation };