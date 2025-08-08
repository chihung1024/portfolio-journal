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
                    return res.status(200).send({ success: true, data: {
                        summary: summaryRow.summary_data ? JSON.parse(summaryRow.summary_data) : {},
                        holdings, transactions: txs, splits, stockNotes,
                        history: summaryRow.history ? JSON.parse(summaryRow.history) : {},
                        twrHistory: summaryRow.twrHistory ? JSON.parse(summaryRow.twrHistory) : {},
                        benchmarkHistory: summaryRow.benchmarkHistory ? JSON.parse(summaryRow.benchmarkHistory) : {},
                    }});
                }
                case 'add_transaction': case 'edit_transaction': {
                    const isEditing = action === 'edit_transaction';
                    const txData = transactionSchema.parse(isEditing ? data.txData : data);
                    const txId = isEditing ? data.txId : uuidv4();
                    if (isEditing) await d1Client.query(`UPDATE transactions SET date = ?, symbol = ?, type = ?, quantity = ?, price = ?, currency = ?, totalCost = ?, exchangeRate = ? WHERE id = ? AND uid = ?`, [txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate, txId, uid]);
                    else await d1Client.query(`INSERT INTO transactions (id, uid, date, symbol, type, quantity, price, currency, totalCost, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [txId, uid, txData.date, txData.symbol, txData.type, txData.quantity, txData.price, txData.currency, txData.totalCost, txData.exchangeRate]);
                    
                    await performRecalculation(uid, txData.date, false);
                    return res.status(200).send({ success: true, message: '操作成功。', id: txId });
                }
                case 'delete_transaction': {
                    const txResult = await d1Client.query('SELECT date FROM transactions WHERE id = ? AND uid = ?', [data.txId, uid]);
                    const txDate = txResult.length > 0 ? txResult[0].date.split('T')[0] : null;
                    
                    await d1Client.query('DELETE FROM transactions WHERE id = ? AND uid = ?', [data.txId, uid]);
                    
                    await performRecalculation(uid, txDate, false);
                    return res.status(200).send({ success: true, message: '交易已刪除。' });
                }
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
                case 'get_dividends_for_management': {
                    const [pendingDividends, confirmedDividends] = await Promise.all([
                        d1Client.query('SELECT * FROM user_pending_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid]),
                        d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY pay_date DESC', [uid])
                    ]);
                    
                    return res.status(200).send({ 
                        success: true, 
                        data: { 
                            pendingDividends: pendingDividends || [], 
                            confirmedDividends: confirmedDividends || [] 
                        }
                    });
                }
                case 'save_user_dividend': {
                    const parsedData = userDividendSchema.parse(data);
                    // [修正] 在執行資料庫操作前，先取得日期
                    const eventDate = parsedData.pay_date; 
                
                    // 刪除對應的待確認股息 (這會影響後續的股息快取計算)
                    await d1Client.query('DELETE FROM user_pending_dividends WHERE uid = ? AND symbol = ? AND ex_dividend_date = ?', [uid, parsedData.symbol, parsedData.ex_dividend_date]);
                
                    const { id, ...divData } = parsedData;
                    const dividendId = id || uuidv4();
                    if (id) {
                        await d1Client.query(`UPDATE user_dividends SET pay_date = ?, total_amount = ?, tax_rate = ?, notes = ? WHERE id = ? AND uid = ?`,[divData.pay_date, divData.total_amount, divData.tax_rate, divData.notes, id, uid]);
                    } else {
                        await d1Client.query(`INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`, [dividendId, uid, divData.symbol, divData.ex_dividend_date, divData.pay_date, divData.amount_per_share, divData.quantity_at_ex_date, divData.total_amount, divData.tax_rate, divData.currency, divData.notes]);
                    }
                
                    // [修正] 傳入正確的配息發放日期
                    await performRecalculation(uid, eventDate, false);
                    return res.status(200).send({ success: true, message: '配息紀錄已儲存。' });
                }
                case 'bulk_confirm_all_dividends': {
                    const pendingDividends = data.pendingDividends || [];
                    if (pendingDividends.length === 0) return res.status(200).send({ success: true, message: '沒有需要批次確認的配息。' });
                
                    // [修正] 取得所有變動日期中最舊的一個，作為失效判斷的依據
                    const oldestPayDate = pendingDividends.reduce((oldest, p) => {
                        const payDate = new Date(p.ex_dividend_date);
                        payDate.setMonth(payDate.getMonth() + 1);
                        return payDate < oldest ? payDate : oldest;
                    }, new Date());
                
                    const dbOps = [];
                    const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
                    for (const pending of pendingDividends) {
                        const payDate = new Date(pending.ex_dividend_date); payDate.setMonth(payDate.getMonth() + 1); const payDateStr = payDate.toISOString().split('T')[0];
                        const taxRate = isTwStock(pending.symbol) ? 0.0 : 0.30; const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate);
                        dbOps.push({ sql: `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '批次確認')`, params: [uuidv4(), uid, pending.symbol, pending.ex_dividend_date, payDateStr, pending.amount_per_share, pending.quantity_at_ex_date, totalAmount, taxRate * 100, pending.currency]});
                    }
                    if (dbOps.length > 0) { 
                        await d1Client.batch(dbOps); 
                        // [修正] 傳入最舊的日期
                        await performRecalculation(uid, oldestPayDate.toISOString().split('T')[0], false);
                    }
                    return res.status(200).send({ success: true, message: `成功批次確認 ${dbOps.length} 筆配息紀錄。` });
                }
                case 'delete_user_dividend': {
                    // [修正] 刪除前需要先查出日期
                    const divResult = await d1Client.query('SELECT pay_date FROM user_dividends WHERE id = ? AND uid = ?', [data.dividendId, uid]);
                    const divDate = divResult.length > 0 ? divResult[0].pay_date.split('T')[0] : null;
                
                    await d1Client.query('DELETE FROM user_dividends WHERE id = ? AND uid = ?', [data.dividendId, uid]);
                
                    // [修正] 傳入正確的配息發放日期
                    await performRecalculation(uid, divDate, false);
                    return res.status(200).send({ success: true, message: '配息紀錄已刪除。' });
                }
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
