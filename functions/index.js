// =========================================================================================
// == GCP Cloud Function 主入口 (v4.0.0 - 支援群組管理)
// =========================================================================================

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const { z } = require("zod");

const { d1Client } = require('./d1.client');
const { performRecalculation } = require('./performRecalculation');
const { verifyFirebaseToken } = require('./middleware');

// 引入所有 handlers
const transactionHandlers = require('./api_handlers/transaction.handler');
const dividendHandlers = require('./api_handlers/dividend.handler');
const splitHandlers = require('./api_handlers/split.handler');
const noteHandlers = require('./api_handlers/note.handler');
const portfolioHandlers = require('./api_handlers/portfolio.handler');
const groupHandlers = require('./api_handlers/group.handler'); // 【新增】引入新的群組處理器

try {
    admin.initializeApp();
} catch (e) {
    // Firebase Admin SDK already initialized
}

exports.unifiedPortfolioHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    // CORS and OPTIONS request handling (維持不變)
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

    // Service Account request handling (維持不變)
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

    // Main request routing
    await verifyFirebaseToken(req, res, async () => {
        try {
            const uid = req.user.uid;
            const { action, data } = req.body;
            if (!action) return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });

            // 【核心修改】在路由分發中增加群組相關的 actions
            switch (action) {
                // Portfolio
                case 'get_data':
                    return await portfolioHandlers.getData(uid, res);
                case 'update_benchmark':
                    return await portfolioHandlers.updateBenchmark(uid, data, res);
                
                // --- 【新增】拆分後的 API ---
                case 'get_dashboard_and_holdings':
                    return await portfolioHandlers.getDashboardAndHoldings(uid, res);
                case 'get_transactions_and_splits':
                    return await portfolioHandlers.getTransactionsAndSplits(uid, res);
                case 'get_chart_data':
                    return await portfolioHandlers.getChartData(uid, res);

                // Transactions
                case 'add_transaction':
                    return await transactionHandlers.addTransaction(uid, data, res);
                case 'edit_transaction':
                    return await transactionHandlers.editTransaction(uid, data, res);
                case 'delete_transaction':
                    return await transactionHandlers.deleteTransaction(uid, data, res);

                // Splits
                case 'add_split':
                    return await splitHandlers.addSplit(uid, data, res);
                case 'delete_split':
                    return await splitHandlers.deleteSplit(uid, data, res);

                // Dividends
                case 'get_dividends_for_management':
                    return await dividendHandlers.getDividendsForManagement(uid, res);
                case 'save_user_dividend':
                    return await dividendHandlers.saveUserDividend(uid, data, res);
                case 'bulk_confirm_all_dividends':
                    return await dividendHandlers.bulkConfirmAllDividends(uid, data, res);
                case 'delete_user_dividend':
                    return await dividendHandlers.deleteUserDividend(uid, data, res);
                
                // Notes
                case 'save_stock_note':
                    return await noteHandlers.saveStockNote(uid, data, res);

                // 【新增】Groups
                case 'get_groups':
                    return await groupHandlers.getGroups(uid, res);
                case 'save_group':
                    return await groupHandlers.saveGroup(uid, data, res);
                case 'delete_group':
                    return await groupHandlers.deleteGroup(uid, data, res);
                case 'calculate_group_on_demand':
                    return await groupHandlers.calculateGroupOnDemand(uid, data, res);

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
