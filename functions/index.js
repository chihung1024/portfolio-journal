const { Router } = require('itty-router');
const { withDurables } = require('itty-durable');
const { withContent, withParams } = require('itty-router-extras');

const { handleScheduled } = require('./worker.js');
const { auth, resolveUser, adminOnly } = require('./middleware.js');

const portfolioHandler = require('./api_handlers/portfolio.handler.js');
const transactionHandler = require('./api_handlers/transaction.handler.js');
const dividendHandler = require('./api_handlers/dividend.handler.js');
const groupHandler = require('./api_handlers/group.handler.js');
const splitHandler = require('./api_handlers/split.handler.js');
const detailsHandler = require('./api_handlers/details.handler.js');
const batchHandler = require('./api_handlers/batch.handler.js');

const router = Router();

router.all('*', withDurables(), withContent(), withParams, resolveUser);

// Portfolio
router.get('/api/portfolio', auth, portfolioHandler.getPortfolio);
router.post('/api/portfolio/recalculate', auth, portfolioHandler.recalculatePortfolio);
router.post('/api/portfolio/settings', auth, portfolioHandler.updateSettings);
router.get('/api/portfolio/export', auth, portfolioHandler.exportPortfolio);
router.post('/api/portfolio/import', auth, portfolioHandler.importPortfolio);

// Transactions
// Note: These routes are now superseded by the batch submission but kept for potential individual use or testing.
router.post('/api/transactions', auth, transactionHandler.createTransaction);
router.put('/api/transactions/:id', auth, transactionHandler.updateTransaction);
router.delete('/api/transactions/:id', auth, transactionHandler.deleteTransaction);
router.put('/api/transactions/group/:id', auth, transactionHandler.updateTransactionGroup);

// Dividends
// Note: These routes are now superseded by the batch submission.
router.get('/api/dividends', auth, dividendHandler.getDividends);
router.post('/api/dividends', auth, dividendHandler.createDividend);
router.put('/api/dividends/:id', auth, dividendHandler.updateDividend);
router.delete('/api/dividends/:id', auth, dividendHandler.deleteDividend);
router.post('/api/dividends/confirm', auth, dividendHandler.confirmDividend);

// Splits
// Note: These routes are now superseded by the batch submission.
router.get('/api/splits', auth, splitHandler.getSplits);
router.post('/api/splits', auth, splitHandler.createSplit);
router.delete('./api/splits/:id', auth, splitHandler.deleteSplit);

// Groups
// Note: These routes are now superseded by the batch submission.
router.get('/api/groups', auth, groupHandler.getGroups);
router.post('/api/groups', auth, groupHandler.createGroup);
router.put('/api/groups/:id', auth, groupHandler.updateGroup);
router.delete('/api/groups/:id', auth, groupHandler.deleteGroup);

// Details
router.get('/api/details/:symbol', auth, detailsHandler.getDetails);

// Batch Submission
router.post('/api/submit-batch', auth, batchHandler.submitBatch);

// Admin
router.get('/api/admin/users', auth, adminOnly, portfolioHandler.getAllUsers);

// 404
router.all('*', () => new Response('Not Found.', { status: 404 }));

module.exports = {
  fetch: router.handle,
  scheduled: handleScheduled,
};