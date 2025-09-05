// js/main.js

import { setupTabs } from './ui/tabs.js';
import { getHoldings, getTransactions, getDividends, getSplits, getGroups } from './api.js';
import { renderPortfolioSummary, renderAssetDistributionChart, renderNetProfitChart, renderTwrChart } from './ui/dashboard.js';
import { renderHoldingsTable } from './ui/components/holdings.ui.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js';
import { renderDividendsTable } from './ui/components/dividends.ui.js';
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { setupTransactionEventListeners } from './events/transaction.events.js';
import { setupGeneralEventListeners } from './events/general.events.js';
import { setupDividendEventListeners } from './events/dividend.events.js';
import { setupClosedPositionsEventListeners } from './events/closed_positions.events.js';
import { setupSplitEventListeners } from './events/split.events.js';
import { setupAuth } from './auth.js';
import state from './state.js';
import { setupGroupEventListeners } from './events/group.events.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { setupStagingEventListeners } from './events/staging.events.js';

async function main() {
    setupTabs();
    setupEventListeners();
    
    // Authenticate and then load data
    await setupAuth();

    if (state.isLoggedIn) {
        document.getElementById('loading-indicator').style.display = 'flex';
        try {
            await loadInitialData();
            renderInitialUI();
        } catch (error) {
            console.error('Failed to load initial data:', error);
            // Optionally show an error message to the user
        } finally {
            document.getElementById('loading-indicator').style.display = 'none';
        }
    }
}

async function loadInitialData() {
    // Using Promise.all to fetch data in parallel for efficiency
    await Promise.all([
        getHoldings(),
        getTransactions(),
        getDividends(),
        getSplits(),
        getGroups(),
    ]);
}

function renderInitialUI() {
    // Render all components with the fetched data
    renderPortfolioSummary(state.portfolioSummary);
    renderHoldingsTable();
    renderAssetDistributionChart(state.chartData.assetDistribution);
    renderNetProfitChart(state.chartData);
    renderTwrChart(state.chartData);
    renderTransactionsTable();
    renderDividendsTable();
    renderSplitsTable();
    renderGroupsTab();
}

function setupEventListeners() {
    setupGeneralEventListeners();
    setupTransactionEventListeners();
    setupDividendEventListeners();
    setupClosedPositionsEventListeners();
    setupSplitEventListeners();
    setupGroupEventListeners();
    setupStagingEventListeners();
}

document.addEventListener('DOMContentLoaded', main);
