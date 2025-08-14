// =========================================================================================
// == File: functions/index.js (Consolidated Entry Point Version)
// =========================================================================================

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const { z } = require("zod");

// Import all necessary modules
const { d1Client } = require('./d1.client');
const { performRecalculation } = require('./performRecalculation');
const { verifyFirebaseToken } = require('./middleware');
const transactionHandlers = require('./api_handlers/transaction.handler');
const dividendHandlers = require('./api_handlers/dividend.handler');
const splitHandlers = require('./api_handlers/split.handler');
const noteHandlers = require('./api_handlers/note.handler');
const portfolioHandlers = require('./api_handlers/portfolio.handler');
const { postTransactionWorker } = require('./postTransactionWorker');

try {
    admin.initializeApp();
} catch (e) {
    // Firebase Admin SDK already initialized
}

// =========================================================================================
// == Main API Function (unifiedPortfolioHandler)
// =========================================================================================
exports.unifiedPortfolioHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    // CORS and OPTIONS request handling
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

    // Handle service requests from Python scripts
    const serviceAccountKey = req.headers['x-service-account-key'];
    if (serviceAccountKey) {
        if (serviceAccountKey !== process.env.SERVICE_ACCOUNT_KEY) {
            return res.status(403).send({ success: false, message: 'Invalid Service Account Key' });
        }
        if (req.body.action === 'recalculate_all_users') {
            try {
                const createSnapshot = req.body.createSnapshot || false;
                console.log(`Received batch recalculation request, createSnapshot: ${createSnapshot}`);
                const allUidsResult = await d1Client.query('SELECT DISTINCT uid FROM transactions');
                for (const row of allUidsResult) {
                    await performRecalculation(row.uid, null, createSnapshot);
                }
                return res.status(200).send({ success: true, message: 'All users recalculated successfully.' });
            } catch (error) { return res.status(500).send({ success: false, message: `Error during recalculation: ${error.message}` }); }
        }
        return res.status(400).send({ success: false, message: 'Invalid service action.' });
    }

    // Handle user requests from the frontend
    await verifyFirebaseToken(req, res, async () => {
        try {
            const uid = req.user.uid;
            const { action, data } = req.body;
            if (!action) return res.status(400).send({ success: false, message: 'Error: Missing action.' });

            switch (action) {
                case 'get_data': return await portfolioHandlers.getData(uid, res);
                case 'update_benchmark': return await portfolioHandlers.updateBenchmark(uid, data, res);
                case 'add_transaction': return await transactionHandlers.addTransaction(uid, data, res);
                case 'edit_transaction': return await transactionHandlers.editTransaction(uid, data, res);
                case 'delete_transaction': return await transactionHandlers.deleteTransaction(uid, data, res);
                case 'add_split': return await splitHandlers.addSplit(uid, data, res);
                case 'delete_split': return await splitHandlers.deleteSplit(uid, data, res);
                case 'get_dividends_for_management': return await dividendHandlers.getDividendsForManagement(uid, res);
                case 'save_user_dividend': return await dividendHandlers.saveUserDividend(uid, data, res);
                case 'bulk_confirm_all_dividends': return await dividendHandlers.bulkConfirmAllDividends(uid, data, res);
                case 'delete_user_dividend': return await dividendHandlers.deleteUserDividend(uid, data, res);
                case 'save_stock_note': return await noteHandlers.saveStockNote(uid, data, res);
                default: return res.status(400).send({ success: false, message: 'Unknown action' });
            }
        } catch (error) {
            console.error(`Error executing action '${req.body?.action}' for user [${req.user?.uid || 'N/A'}]:`, error);
            if (error instanceof z.ZodError) return res.status(400).send({ success: false, message: "Input data validation failed", errors: error.errors });
            res.status(500).send({ success: false, message: `Internal server error: ${error.message}` });
        }
    });
});

// =========================================================================================
// == Background Worker Function (backgroundTaskHandler)
// =========================================================================================
exports.backgroundTaskHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    // Step 1: Security validation
    const internalServiceKey = req.headers['x-internal-service-key'];
    if (internalServiceKey !== process.env.SERVICE_ACCOUNT_KEY) {
        console.error('Invalid internal service key.');
        return res.status(403).send('Unauthorized');
    }

    try {
        // Step 2: Parse the task
        const body = JSON.parse(Buffer.from(req.body, 'base64').toString());
        const { workerName, payload } = body;

        console.log(`Received background task: ${workerName}, Payload:`, payload);

        // Step 3: Dispatch to the correct worker logic
        switch (workerName) {
            case 'postTransactionWorker':
                await postTransactionWorker(payload);
                break;
            default:
                console.error(`Unknown worker name: ${workerName}`);
                return res.status(400).send('Unknown worker name');
        }

        // Step 4: Acknowledge successful completion to Cloud Tasks
        console.log(`Background task ${workerName} completed successfully.`);
        return res.status(200).send('Task completed successfully.');

    } catch (error) {
        console.error('Background worker execution failed:', error);
        // Return a 500 error to let Cloud Tasks know the task failed and should be retried
        return res.status(500).send('Task failed');
    }
});
