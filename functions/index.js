// =========================================================================================
// == GCP Cloud Function 主入口 (v3.8.0 - 支援快照失效判斷)
// =========================================================================================

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");

const { d1Client } = require('./d1.client');
const { performRecalculation } = require('./calculation.engine');
const { transactionSchema, splitSchema, userDividendSchema } = require('./schemas');
const { verifyFirebaseToken } = require('./middleware');
// 【修改】引入新的 handlers
const transactionHandlers = require('./api_handlers/transaction.handler');
const dividendHandlers = require('./api_handlers/dividend.handler');

try {
    admin.initializeApp();
} catch (e) {
    // Firebase Admin SDK already initialized
}

exports.unifiedPortfolioHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    const allowedOrigins = [
        'https://portfolio-journal.pages.dev',
        'https://portfolio-journal-467915.firebaseapp.com'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
    }
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Service-Account-Key, X-API-KEY');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const serviceAccountKey = req.headers['x-service-account-key'];
    if (serviceAccountKey) {
        if (serviceAccountKey !== process.env.SERVICE_ACCOUNT_KEY) {
            return res.status(403).send({ success: false, message: 'Invalid Service Account Key' });
        }
        if (req.body.action === 'recalculate_all_users') {
            try {
                const createSnapshot = req.body.createSnapshot || false;
                console.log(`收到批次重算請求，是否建立快照: ${createSnapshot}`);

                const allUidsResult = await d1Client.query('SELECT DISTINCT uid FROM transactions');
                for (const row of allUidsResult) {
                    await performRecalculation(row.uid, null, createSnapshot);
                }
                return res.status(200).send({ success: true, message: '所有使用者重算成功。' });
            } catch (error) { return res.status(500).send({ success: false, message: `重算過程中發生錯誤: ${error.message}` }); }
        }
        return res.status(400).send({ success: false, message: '無效的服務操作。' });
    }

    await verifyFirebaseToken(req, res, async () => {
        try {
            const uid = req.user.uid;
            const { action, data } = req.body;
            if (!action) return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });

            switch (action) {
                case 'get_data': {
                    const [txs, splits, holdings, summaryResult, stockNotes] = await Promise.all([
                        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date DESC', [uid]),
                        d1Client.query('SELECT * FROM splits WHERE uid = ? ORDER BY date DESC', [uid]),
                        d1Client.query('SELECT * FROM holdings WHERE uid = ?', [uid]),
                        d1Client.query('SELECT * FROM portfolio_summary WHERE uid = ?', [uid]),
                        d1Client.query('SELECT * FROM user_stock_notes WHERE uid = ?', [uid])
                    ]);
                    const summaryRow = summaryResult[0] || {};
                    return res.status(200).send({
                        success: true, data: {
                            summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
                            holdings, transactions: txs, splits, stockNotes,
                            history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
                            twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
                            benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
                            netProfitHistory: summaryRow.netProfitHistory ? JSON.parse(summaryRow.netProfitHistory) : {},
                        }
                    });
                }
                case 'add_transaction':
                    return await transactionHandlers.addTransaction(uid, data, res);

                case 'edit_transaction':
                    return await transactionHandlers.editTransaction(uid, data, res);

                case 'delete_transaction':
                    return await transactionHandlers.deleteTransaction(uid, data, res);

                case 'update_benchmark': {
                    await d1Client.query('INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)', [uid, 'benchmarkSymbol', data.benchmarkSymbol.toUpperCase()]);
                    await performRecalculation(uid, null, false);
                    return res.status(200).send({ success: true, message: '基準已更新。' });
                }
                case 'add_split': {
                    const splitData = splitSchema.parse(data); const newSplitId = uuidv4();
                    await d1Client.query(`INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`, [newSplitId, uid, splitData.date, splitData.symbol, splitData.ratio]);
                    await performRecalculation(uid, splitData.date, false);
                    return res.status(200).send({ success: true, message: '分割事件已新增。', splitId: newSplitId });
                }
                case 'delete_split': {
                    const splitResult = await d1Client.query('SELECT date FROM splits WHERE id = ? AND uid = ?', [data.splitId, uid]);
                    const splitDate = splitResult.length > 0 ? splitResult[0].date.split('T')[0] : null;
                    await d1Client.query('DELETE FROM splits WHERE id = ? AND uid = ?', [data.splitId, uid]);
                    await performRecalculation(uid, splitDate, false);
                    return res.status(200).send({ success: true, message: '分割事件已刪除。' });
                }
                // 【重構】替換為對 handler 的呼叫
                case 'get_dividends_for_management':
                    return await dividendHandlers.getDividendsForManagement(uid, res);

                // 【重構】替換為對 handler 的呼叫
                case 'save_user_dividend':
                    return await dividendHandlers.saveUserDividend(uid, data, res);

                // 【重構】替換為對 handler 的呼叫
                case 'bulk_confirm_all_dividends':
                    return await dividendHandlers.bulkConfirmAllDividends(uid, data, res);

                // 【重構】替換為對 handler 的呼叫
                case 'delete_user_dividend':
                    return await dividendHandlers.deleteUserDividend(uid, data, res);

                case 'save_stock_note': {
                    const { symbol, target_price, stop_loss_price, notes } = data;
                    const existing = await d1Client.query('SELECT id FROM user_stock_notes WHERE uid = ? AND symbol = ?', [uid, symbol]);
                    if (existing.length > 0) await d1Client.query('UPDATE user_stock_notes SET target_price = ?, stop_loss_price = ?, notes = ?, last_updated = ? WHERE id = ?', [target_price, stop_loss_price, notes, new Date().toISOString(), existing[0].id]);
                    else await d1Client.query('INSERT INTO user_stock_notes (id, uid, symbol, target_price, stop_loss_price, notes, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)', [uuidv4(), uid, symbol, target_price, stop_loss_price, notes, new Date().toISOString()]);
                    return res.status(200).send({ success: true, message: '筆記已儲存。' });
                }
                default:
                    return res.status(400).send({ success: false, message: '未知的操作' });
            }
        } catch (error) {
            console.error(`[${req.user?.uid || 'N/A'}] 執行 action: '${req.body?.action}' 時發生錯誤:`, error);
            if (error instanceof z.ZodError) return res.status(400).send({ success: false, message: "輸入資料格式驗證失敗", errors: error.errors });
            res.status(500).send({ success: false, message: `伺服器內部錯誤：${error.message}` });
        }
    });
});
