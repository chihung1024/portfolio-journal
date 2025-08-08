// =========================================================================================
// == GCP Cloud Function 安全性強化版 (v3.6.0 - 非同步架構重構版)
// =========================================================================================

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { z } = require("zod");
const { performRecalculation } = require('./calculationEngine');
const axios = require("axios"); // 仍然需要 d1Client

try {
  admin.initializeApp();
  console.log('Firebase Admin SDK 初始化成功。');
} catch (e) {
  console.error('Firebase Admin SDK 初始化失敗:', e);
}

// --- 平台設定 ---
const D1_WORKER_URL = process.env.D1_WORKER_URL;
const D1_API_KEY = process.env.D1_API_KEY;

// --- D1 資料庫客戶端 ---
// 保持 d1Client 在這裡，因為非計算的操作 (如增刪改查) 仍由此函式處理
const d1Client = {
    async query(sql, params = []) {
        if (!D1_WORKER_URL || !D1_API_KEY) { throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set."); }
        try {
            const response = await axios.post(`${D1_WORKER_URL}/query`, { sql, params }, { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } });
            if (response.data && response.data.success) { return response.data.results; }
            throw new Error(response.data.error || "D1 查詢失敗");
        } catch (error) {
            console.error("d1Client.query Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 query: ${error.message}`);
        }
    },
    async batch(statements) {
       if (!D1_WORKER_URL || !D1_API_KEY) { throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set."); }
        try {
            const response = await axios.post(`${D1_WORKER_URL}/batch`, { statements }, { headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' } });
            if (response.data && response.data.success) { return response.data.results; }
            throw new Error(response.data.error || "D1 批次操作失敗");
        } catch (error) {
            console.error("d1Client.batch Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 batch: ${error.message}`);
        }
    }
};

// --- 安全性中介軟體 (Middleware) ---
const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(403).send({ success: false, message: 'Unauthorized: Missing or invalid authorization token.'});
        return;
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Token 驗證失敗:', error.message);
        res.status(403).send({ success: false, message: 'Unauthorized: Token verification failed. 請嘗試重新登入。'});
    }
};

// --- Zod Schema 定義 ---
const transactionSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    symbol: z.string().min(1).transform(val => val.toUpperCase().trim()),
    type: z.enum(['buy', 'sell']),
    quantity: z.number().positive(),
    price: z.number().positive(),
    currency: z.enum(['USD', 'TWD', 'HKD', 'JPY']),
    totalCost: z.number().positive().optional().nullable(),
    exchangeRate: z.number().positive().optional().nullable(),
});
const splitSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    symbol: z.string().min(1).transform(val => val.toUpperCase().trim()),
    ratio: z.number().positive(),
});
const userDividendSchema = z.object({
    id: z.string().uuid().optional(),
    symbol: z.string(),
    ex_dividend_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantity_at_ex_date: z.number(),
    amount_per_share: z.number(),
    total_amount: z.number(),
    tax_rate: z.number().min(0).max(100),
    currency: z.string(),
    notes: z.string().optional().nullable(),
});

// --- HTTP 請求主處理函式 ---
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
    
    // 移除了舊的 Service Account Key 檢查，因為重算邏輯已分離
    
    await verifyFirebaseToken(req, res, async () => {
        try {
            const uid = req.user.uid; 
            const { action, data } = req.body;
            if (!action) return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });

            switch (action) {
                // ... (此處保留所有 case，除了 'recalculate_all_users')
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
                    await performRecalculation(uid);
                    return res.status(200).send({ success: true, message: '操作成功。', id: txId });
                }
                case 'delete_transaction': {
                    await d1Client.query('DELETE FROM transactions WHERE id = ? AND uid = ?', [data.txId, uid]);
                    await performRecalculation(uid); return res.status(200).send({ success: true, message: '交易已刪除。' });
                }
                case 'update_benchmark': {
                    await d1Client.query('INSERT OR REPLACE INTO controls (uid, key, value) VALUES (?, ?, ?)', [uid, 'benchmarkSymbol', data.benchmarkSymbol.toUpperCase()]);
                    await performRecalculation(uid); return res.status(200).send({ success: true, message: '基準已更新。' });
                }
                case 'add_split': {
                    const splitData = splitSchema.parse(data); const newSplitId = uuidv4();
                    await d1Client.query(`INSERT INTO splits (id, uid, date, symbol, ratio) VALUES (?,?,?,?,?)`, [newSplitId, uid, splitData.date, splitData.symbol, splitData.ratio]);
                    await performRecalculation(uid); return res.status(200).send({ success: true, message: '分割事件已新增。', splitId: newSplitId });
                }
                case 'delete_split': {
                    await d1Client.query('DELETE FROM splits WHERE id = ? AND uid = ?', [data.splitId, uid]);
                    await performRecalculation(uid); return res.status(200).send({ success: true, message: '分割事件已刪除。' });
                }
                case 'get_dividends_for_management': {
                    const [txs, allDividendsHistory, userDividends] = await Promise.all([
                        d1Client.query('SELECT * FROM transactions WHERE uid = ? ORDER BY date ASC', [uid]),
                        d1Client.query('SELECT * FROM dividend_history ORDER BY date ASC'),
                        d1Client.query('SELECT * FROM user_dividends WHERE uid = ? ORDER BY ex_dividend_date DESC', [uid])
                    ]);
                    if (txs.length === 0) return res.status(200).send({ success: true, data: { pendingDividends: [], confirmedDividends: userDividends } });
                    const holdings = {}; let txIndex = 0; const confirmedKeys = new Set(userDividends.map(d => `${d.symbol}_${d.ex_dividend_date.split('T')[0]}`));
                    const pendingDividends = []; const uniqueSymbolsInTxs = [...new Set(txs.map(t => t.symbol))];
                    allDividendsHistory.forEach(histDiv => {
                        const divSymbol = histDiv.symbol; if (!uniqueSymbolsInTxs.includes(divSymbol)) return;
                        const exDateStr = histDiv.date.split('T')[0]; if (confirmedKeys.has(`${divSymbol}_${exDateStr}`)) return;
                        const exDateMinusOne = new Date(exDateStr); exDateMinusOne.setDate(exDateMinusOne.getDate() - 1);
                        while(txIndex < txs.length && new Date(txs[txIndex].date) <= exDateMinusOne) {
                            const tx = txs[txIndex]; holdings[tx.symbol] = (holdings[tx.symbol] || 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity); txIndex++;
                        }
                        const quantity = holdings[divSymbol] || 0;
                        if (quantity > 0) {
                             const currency = txs.find(t => t.symbol === divSymbol)?.currency || (isTwStock(divSymbol) ? 'TWD' : 'USD');
                             pendingDividends.push({ symbol: divSymbol, ex_dividend_date: exDateStr, amount_per_share: histDiv.dividend, quantity_at_ex_date: quantity, currency: currency });
                        }
                    });
                    return res.status(200).send({ success: true, data: { pendingDividends: pendingDividends.sort((a,b) => new Date(b.ex_dividend_date) - new Date(a.ex_dividend_date)), confirmedDividends: userDividends }});
                }
                case 'save_user_dividend': {
                    const parsedData = userDividendSchema.parse(data); const { id, ...divData } = parsedData; const dividendId = id || uuidv4();
                    if (id) await d1Client.query(`UPDATE user_dividends SET pay_date = ?, total_amount = ?, tax_rate = ?, notes = ? WHERE id = ? AND uid = ?`,[divData.pay_date, divData.total_amount, divData.tax_rate, divData.notes, id, uid]);
                    else await d1Client.query(`INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`, [dividendId, uid, divData.symbol, divData.ex_dividend_date, divData.pay_date, divData.amount_per_share, divData.quantity_at_ex_date, divData.total_amount, divData.tax_rate, divData.currency, divData.notes]);
                    await performRecalculation(uid); return res.status(200).send({ success: true, message: '配息紀錄已儲存。' });
                }
                case 'bulk_confirm_all_dividends': {
                    const pendingDividends = data.pendingDividends || [];
                    if (pendingDividends.length === 0) return res.status(200).send({ success: true, message: '沒有需要批次確認的配息。' });
                    const dbOps = [];
                    for (const pending of pendingDividends) {
                        const payDate = new Date(pending.ex_dividend_date); payDate.setMonth(payDate.getMonth() + 1); const payDateStr = payDate.toISOString().split('T')[0];
                        const taxRate = isTwStock(pending.symbol) ? 0.0 : 0.30; const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate);
                        dbOps.push({ sql: `INSERT INTO user_dividends (id, uid, symbol, ex_dividend_date, pay_date, amount_per_share, quantity_at_ex_date, total_amount, tax_rate, currency, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '批次確認')`, params: [uuidv4(), uid, pending.symbol, pending.ex_dividend_date, payDateStr, pending.amount_per_share, pending.quantity_at_ex_date, totalAmount, taxRate * 100, pending.currency]});
                    }
                    if (dbOps.length > 0) { await d1Client.batch(dbOps); await performRecalculation(uid); }
                    return res.status(200).send({ success: true, message: `成功批次確認 ${dbOps.length} 筆配息紀錄。` });
                }
                case 'delete_user_dividend': {
                    await d1Client.query('DELETE FROM user_dividends WHERE id = ? AND uid = ?', [data.dividendId, uid]);
                    await performRecalculation(uid); return res.status(200).send({ success: true, message: '配息紀錄已刪除。' });
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

// 引入並導出新的 Pub/Sub Worker 函式
const { processRecalculationTask } = require('./recalculationWorker');
exports.processRecalculationTask = processRecalculationTask;
