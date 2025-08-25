// =========================================================================================
// == Cloud Function 主入口 (v6.2 - Staging-Complete)
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
const stagingHandlers = require('./api_handlers/staging.handler');
const noteHandlers = require('./api_handlers/note.handler'); // 重新引入 note handler

try { admin.initializeApp(); } catch (e) { /* Already initialized */ }

exports.unifiedPortfolioHandler = async (req, res) => {
    // CORS and OPTIONS request handling
    const allowedOrigins = ['https://portfolio-journal.pages.dev', 'https://dev.portfolio-journal.pages.dev', 'https://portfolio-journal-467915.firebaseapp.com'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) res.set('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Max-Age', '3600');
        return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    // Service Account request handling for batch jobs
    if (req.headers['x-service-account-key']) {
        if (req.headers['x-service-account-key'] !== process.env.SERVICE_ACCOUNT_KEY) return res.status(403).send({ success: false, message: 'Invalid Service Account Key' });
        if (req.body.action === 'recalculate_all_users') {
            const allUids = await d1Client.query('SELECT DISTINCT uid FROM transactions');
            for (const row of allUids) await performRecalculation(row.uid, null, req.body.createSnapshot || false);
            return res.status(200).send({ success: true, message: '所有使用者重算成功。' });
        }
        return res.status(400).send({ success: false, message: '無效的服務操作。' });
    }

    // Main request routing for authenticated users
    await verifyFirebaseToken(req, res, async () => {
        try {
            const uid = req.user.uid;
            const { action, data } = req.body;
            if (!action) return res.status(400).send({ success: false, message: '請求錯誤：缺少 action。' });

            switch (action) {
                // --- Read-only Portfolio/Details Actions ---
                case 'get_data': return await portfolioHandlers.getData(uid, res);
                case 'get_dashboard_and_holdings': return await portfolioHandlers.getDashboardAndHoldings(uid, res);
                case 'get_dashboard_summary': return await portfolioHandlers.getDashboardSummary(uid, res);
                case 'get_holdings': return await portfolioHandlers.getHoldings(uid, res);
                case 'get_transactions_and_splits': return await portfolioHandlers.getTransactionsAndSplits(uid, res);
                case 'get_chart_data': return await portfolioHandlers.getChartData(uid, res);
                case 'get_symbol_details': return await detailsHandlers.getSymbolDetails(uid, data, res);
                
                // --- Read-only Group Actions ---
                case 'get_groups': return await groupHandlers.getGroups(uid, res);
                case 'get_group_details': return await groupHandlers.getGroupDetails(uid, data, res);
                case 'get_transaction_memberships': return await groupHandlers.getTransactionMemberships(uid, data, res);
                case 'calculate_group_on_demand': return await groupHandlers.calculateGroupOnDemand(uid, data, res);

                // --- Staging Area Actions ---
                case 'stage_change':
                    return await stagingHandlers.stageChange(uid, data, res);
                case 'commit_all_changes':
                    return await stagingHandlers.commitAllChanges(uid, res);
                case 'revert_staged_change':
                    return await stagingHandlers.revertStagedChange(uid, data, res);
                case 'discard_all_changes':
                    return await stagingHandlers.discardAllChanges(uid, res);

                // --- Staged-Read Actions ---
                case 'get_transactions_with_staging':
                    return await stagingHandlers.getTransactionsWithStaging(uid, res);
                case 'get_splits_with_staging':
                    return await stagingHandlers.getSplitsWithStaging(uid, res);
                case 'get_dividends_with_staging':
                    return await stagingHandlers.getDividendsWithStaging(uid, res);
                case 'get_groups_with_staging':
                    return await groupHandlers.getGroupsWithStaging(uid, res);
                // ========================= 【核心修改 - 開始】 =========================
                case 'get_notes_with_staging':
                    return await noteHandlers.getNotesWithStaging(uid, res);
                // ========================= 【核心修改 - 結束】 =========================
                
                // --- Legacy Actions (to be deprecated or refactored) ---
                case 'update_benchmark': // This one doesn't use staging yet
                    return await portfolioHandlers.updateBenchmark(uid, data, res);

                default:
                    return res.status(400).send({ success: false, message: '未知的操作' });
            }
        } catch (error) {
            console.error(`[${req.user?.uid || 'N/A'}] 執行 action: '${req.body?.action}' 時發生錯誤:`, error);
            if (error instanceof z.ZodError) return res.status(400).send({ success: false, message: "輸入資料格式驗證失敗", errors: error.errors });
            res.status(500).send({ success: false, message: `伺服器內部錯誤：${error.message}` });
        }
    });
};
