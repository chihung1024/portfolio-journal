/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// const {onRequest} = require("firebase-functions/v2/https");
// const logger = require("firebase-functions/logger");

const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const portfolioHandler = require("./api_handlers/portfolio.handler");
const transactionHandler = require("./api_handlers/transaction.handler");
const dividendHandler = require("./api_handlers/dividend.handler");
const splitHandler = require("./api_handlers/split.handler");
const groupHandler = require("./api_handlers/group.handler");
const detailsHandler = require("./api_handlers/details.handler");
const closedPositionsHandler = require("./api_handlers/closed_positions.handler");
const batchHandler = require("./api_handlers/batch.handler");
const { a, b, c, d } = require("./middleware");

setGlobalOptions({ region: "asia-east1" });

/**
 * API設計：
 * 統一透過 /api 入口，並根據 action 參數分發到不同的 handler。
 * a: CORS middleware
 * b: Firebase Auth middleware
 * c: body parsing middleware
 * d: action-based routing middleware
 */
exports.api = onRequest({ cors: true }, async (req, res) => {
    // 應用的主要 API 端點，透過 action 參數來區分不同的操作
    const handlers = {
        // Portfolio
        get_user_portfolio: portfolioHandler.getUserPortfolio,

        // Transactions
        get_transactions: transactionHandler.getTransactions,
        add_transaction: transactionHandler.addTransaction,
        update_transaction: transactionHandler.updateTransaction,
        delete_transaction: transactionHandler.deleteTransaction,
        get_transaction_memberships: transactionHandler.getTransactionMemberships,
        update_transaction_group_membership: transactionHandler.updateTransactionGroupMembership,
        get_total_transactions_count: transactionHandler.getTotalTransactionsCount,

        // Dividends
        get_dividends: dividendHandler.getDividends,
        add_dividend: dividendHandler.addDividend,
        update_dividend: dividendHandler.updateDividend,
        delete_dividend: dividendHandler.deleteDividend,
        confirm_pending_dividends: dividendHandler.confirmPendingDividends,
        get_pending_dividends: dividendHandler.getPendingDividends,

        // Splits
        get_splits: splitHandler.getSplits,
        add_split: splitHandler.addSplit,
        update_split: splitHandler.updateSplit,
        delete_split: splitHandler.deleteSplit,

        // Groups
        get_groups: groupHandler.getGroups,
        save_group: groupHandler.saveGroup,
        delete_group: groupHandler.deleteGroup,
        calculate_group_on_demand: groupHandler.calculateGroupOnDemand,

        // [新增] Group Members Management - 取得群組成員用於編輯
        get_group_members_for_editing: groupHandler.getGroupMembersForEditing,
        // [新增] Group Members Management - 更新群組成員
        update_group_members: groupHandler.updateGroupMembers,

        // Details Modal
        get_details: detailsHandler.getDetails,

        // Closed Positions
        get_closed_positions: closedPositionsHandler.getClosedPositions,
        get_closed_positions_count: closedPositionsHandler.getClosedPositionsCount,

        // Batch (Staging)
        submit_batch: batchHandler.submitBatch,
    };

    // 順序：a (CORS) -> b (Auth) -> c (Body Parser) -> d (Router)
    // 由於 Firebase Hosting 的 CORS 設定與 Cloud Functions v2 onRequest 的 cors:true 選項，
    // a (CORS middleware) 實際上可以省略，但保留結構以供未來擴展。
    // await a(req, res, async () => { // CORS middleware
    await b(req, res, async () => { // Auth middleware
        await c(req, res, async () => { // body-parser middleware
            await d(req, res, handlers); // action-based routing
        });
    });
    // });
});
