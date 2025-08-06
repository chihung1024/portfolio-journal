// =========================================================================================
// == GCP Cloud Function 安全性強化版 (v4.0 - 全新直接查詢模式)
// =========================================================================================

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const yahooFinance = require("yahoo-finance2").default;
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");

try {
  admin.initializeApp();
} catch (e) {
  console.error('Firebase Admin SDK 初始化失敗', e);
}

const D1_WORKER_URL = process.env.D1_WORKER_URL;
const D1_API_KEY = process.env.D1_API_KEY;

const d1Client = {
    async query(sql, params = []) {
        if (!D1_WORKER_URL || !D1_API_KEY) { throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set."); }
        try {
            const response = await axios.post(`${D1_WORKER_URL}/query`, { sql, params }, { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } });
            return response.data.results;
        } catch (error) {
            console.error("d1Client.query Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 query: ${error.message}`);
        }
    },
    async batch(statements) {
        if (!D1_WORKER_URL || !D1_API_KEY) { throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set."); }
        try {
            const response = await axios.post(`${D1_WORKER_URL}/batch`, { statements }, { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } });
            return response.data.results;
        } catch (error) {
            console.error("d1Client.batch Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 batch: ${error.message}`);
        }
    }
};

// ... (verifyFirebaseToken, schemas, and other utility functions remain the same) ...

// [NEW LOGIC] A much simpler and more reliable way to get holdings on a specific date.
async function getSharesOnDate(uid, symbol, dateStr) {
    const txs = await d1Client.query(
        `SELECT type, quantity, ratio FROM (
            SELECT type, quantity, NULL as ratio, date FROM transactions WHERE uid = ? AND symbol = ? AND date <= ?
            UNION ALL
            SELECT 'split' as type, NULL as quantity, ratio, date FROM splits WHERE uid = ? AND symbol = ? AND date <= ?
        ) ORDER BY date ASC`,
        [uid, symbol, dateStr, uid, symbol, dateStr]
    );

    let totalShares = 0;
    for (const tx of txs) {
        if (tx.type === 'buy') {
            totalShares += tx.quantity;
        } else if (tx.type === 'sell') {
            totalShares -= tx.quantity;
        } else if (tx.type === 'split') {
            totalShares *= tx.ratio;
        }
    }
    return totalShares > 0 ? totalShares : 0;
}


// [NEW LOGIC] The new dividend generation function using the direct query method.
async function generatePendingDividends(uid) {
    console.log(`[${uid}] [v4.0] 開始掃描配息...`);
    const userSymbols = (await d1Client.query('SELECT DISTINCT symbol FROM transactions WHERE uid = ?', [uid])).map(r => r.symbol);
    const allGlobalDividends = await d1Client.query('SELECT * FROM dividend_history WHERE symbol IN (SELECT DISTINCT symbol FROM transactions WHERE uid = ?)', [uid]);
    const existingUserDividends = await d1Client.query('SELECT symbol, date FROM user_dividends WHERE uid = ?', [uid]);
    const existingSet = new Set(existingUserDividends.map(d => `${d.symbol}|${d.date.split('T')[0]}`));
    const newDividendsToInsert = [];

    for (const globalDiv of allGlobalDividends) {
        const divDateStr = globalDiv.date.split('T')[0];
        const sym = globalDiv.symbol.toUpperCase();

        if (existingSet.has(`${sym}|${divDateStr}`)) {
            continue;
        }

        const sharesOnDate = await getSharesOnDate(uid, sym, divDateStr);
        console.log(`[${uid}] [v4.0] 檢查 ${sym} 在 ${divDateStr} 的持股: ${sharesOnDate} 股`);

        if (sharesOnDate > 0) {
            const currency = (await d1Client.query('SELECT currency FROM transactions WHERE uid = ? and symbol = ? ORDER BY date DESC LIMIT 1', [uid, sym]))[0]?.currency || 'USD';
            const grossAmount = sharesOnDate * globalDiv.dividend;
            const taxRate = isTwStock(sym) ? 0.0 : 0.3;
            const estimatedTax = grossAmount * taxRate;
            const netAmount = grossAmount - estimatedTax;

            newDividendsToInsert.push({
                sql: `INSERT INTO user_dividends (id, uid, symbol, date, quantity, dividend_per_share, gross_amount, net_amount, tax, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [uuidv4(), uid, sym, divDateStr, sharesOnDate, globalDiv.dividend, grossAmount, netAmount, estimatedTax, currency, 'pending']
            });
            existingSet.add(`${sym}|${divDateStr}`);
        }
    }

    if (newDividendsToInsert.length > 0) {
        await d1Client.batch(newDividendsToInsert);
        console.log(`[${uid}] [v4.0] 成功產生了 ${newDividendsToInsert.length} 筆新的待確認配息紀錄。`);
    }
}

// [REWRITTEN] The recalculation function is now much simpler.
async function performRecalculation(uid) {
    console.log(`--- [${uid}] 重新計算程序開始 (v4.0 - 直接查詢模式) ---`);
    try {
        // The core logic for TWR, XIRR, etc., still needs the full event list.
        // But the dividend generation is now independent and more robust.
        const [txs, splits, controlsData, userDividends] = await Promise.all([
            d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date ASC', [uid]),
            d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol']),
            d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid])
        ]);

        if (txs.length === 0) {
            // ... cleanup logic ...
            return;
        }

        // The existing financial calculations remain the same for now.
        // ... (The complex logic of prepareEvents, calculateCoreMetrics, etc. would still be here)
        // For the purpose of fixing the dividend generation, we will focus on that part.

        await generatePendingDividends(uid);

        console.log(`--- [${uid}] 重新計算程序完成 ---`);
    } catch (e) {
        console.error(`[${uid}] 計算期間發生嚴重錯誤：`, e);
        throw e;
    }
}

// The main handler remains the same, as it just dispatches actions.
exports.unifiedPortfolioHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    // ... (CORS, API Key, and Service Account checks remain the same) ...

    // This part also remains the same.
    await verifyFirebaseToken(req, res, async () => {
        const uid = req.user.uid;
        const { action, data } = req.body;

        switch (action) {
            // ... (all other cases like get_data, add_transaction, etc., remain the same)
            case 'recalculate': {
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: `${uid} 的重新計算成功` });
            }
            case 'update_dividend': {
                if (!uid) return res.status(400).send({ success: false, message: '請求錯誤：缺少 uid。' });
                const { id, net_amount, tax, notes } = data;
                if (!id) return res.status(400).send({ success: false, message: '請求錯誤：缺少配息紀錄 ID。' });

                await d1Client.query(
                    'UPDATE user_dividends SET net_amount = ?, tax = ?, notes = ?, status = ? WHERE id = ? AND uid = ?',
                    [net_amount, tax, notes, 'confirmed', id, uid]
                );

                // After confirming a dividend, a full recalculation is needed for financial metrics.
                await performRecalculation(uid);
                return res.status(200).send({ success: true, message: '配息紀錄已更新並確認。' });
            }
            // ... (other cases)
        }
    });
});
