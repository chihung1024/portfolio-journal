// =========================================================================================
// == GCP Cloud Function 主入口 (v6.0.0 - 統一 CUD 入口)
// =========================================================================================

const admin = require('firebase-admin');
const { z } = require("zod");

const { d1Client } = require('./d1.client');
const { performRecalculation } = require('./performRecalculation');
const { verifyFirebaseToken } = require('./middleware');

// 引入所有 handlers
const portfolioHandlers = require('./api_handlers/portfolio.handler');
const groupHandlers = require('./api_handlers/group.handler');
const detailsHandlers = require('./api_handlers/details.handler');
const dividendHandlers = require('./api_handlers/dividend.handler');
const syncHandlers = require('./api_handlers/sync.handler'); // 【新增】引入新的 sync handler

// 【移除】舊的、分散的 handler，因為它們的功能已被 sync handler 取代
// const transactionHandlers = require('./api_handlers/transaction.handler');
// const splitHandlers = require('./api_handlers/split.handler');
// const noteHandlers = require('./api_handlers/note.handler');


try {
    admin.initializeApp();
} catch (e) {
    // Firebase Admin SDK already initialized
}

exports.unifiedPortfolioHandler = async (req, res) => {
    // CORS and OPTIONS request handling
    const allowedOrigins = [
        'https://portfolio-journal.pages.dev',
        'https://dev.portfolio-journal.pages.dev',
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

    // Service Account request handling
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

            // ========================= 【核心修改 - 開始】 =========================
            switch (action) {
                // --- 【新增】統一的 CUD 入口 ---
                case 'sync_operations':
                    return await syncHandlers.syncOperations(uid, data, res);

                // --- 讀取 (Read) 類型操作 (維持不變) ---
                case 'get_data':
                    return await portfolioHandlers.getData(uid, res);
                case 'update_benchmark': // 雖然是 Update，但其邏輯特殊(立即重算)，故保留
                    return await portfolioHandlers.updateBenchmark(uid, data, res);
                case 'get_dashboard_and_holdings':
                    return await portfolioHandlers.getDashboardAndHoldings(uid, res);
                case 'get_dashboard_summary':
                    return await portfolioHandlers.getDashboardSummary(uid, res);
                case 'get_holdings':
                    return await portfolioHandlers.getHoldings(uid, res);
                case 'get_transactions_and_splits':
                    return await portfolioHandlers.getTransactionsAndSplits(uid, res);
                case 'get_chart_data':
                    return await portfolioHandlers.getChartData(uid, res);
                case 'get_symbol_details':
                    return await detailsHandlers.getSymbolDetails(uid, data, res);
                case 'get_dividends_for_management':
                    return await dividendHandlers.getDividendsForManagement(uid, res);
                case 'get_groups':
                    return await groupHandlers.getGroups(uid, res);
                case 'get_group_details':
                    return await groupHandlers.getGroupDetails(uid, data, res);
                case 'get_transaction_memberships':
                    return await groupHandlers.getTransactionMemberships(uid, data, res);
                case 'calculate_group_on_demand':
                    return await groupHandlers.calculateGroupOnDemand(uid, data, res);

                // --- 【移除】舊的、分散的 CUD 操作 ---
                // case 'add_transaction':
                // case 'edit_transaction':
                // case 'delete_transaction':
                // case 'add_split':
                // case 'delete_split':
                // case 'save_user_dividend':
                // case 'bulk_confirm_all_dividends':
                // case 'delete_user_dividend':
                // case 'save_stock_note':
                // case 'save_group':
                // case 'delete_group':
                // case 'update_transaction_group_membership':

                default:
                    return res.status(400).send({ success: false, message: '未知的操作' });
            }
            // ========================= 【核心修改 - 結束】 =========================
        } catch (error) {
            console.error(`[${req.user?.uid || 'N/A'}] 執行 action: '${req.body?.action}' 時發生錯誤:`, error);
            if (error instanceof z.ZodError) return res.status(400).send({ success: false, message: "輸入資料格式驗證失敗", errors: error.errors });
            res.status(500).send({ success: false, message: `伺服器內部錯誤：${error.message}` });
        }
    });
};