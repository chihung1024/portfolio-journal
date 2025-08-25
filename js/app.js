// =========================================================================================
// == App Core Control (app.js) v1.8 - Race Condition Fix
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest } from './api.js';

// --- UI Module Imports ---
import { initializeAssetChart, updateAssetChart } from './ui/charts/assetChart.js';
import { initializeTwrChart, updateTwrChart } from './ui/charts/twrChart.js';
import { initializeNetProfitChart, updateNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderDividendsManagementTab } from './ui/components/dividends.ui.js';
import { renderHoldingsTable } from './ui/components/holdings.ui.js';
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js';
import { updateDashboard } from './ui/dashboard.js';
import { showNotification } from './ui/notifications.js';
import { getDateRangeForPreset } from './ui/utils.js';
import { initializeStagingEventListeners, updateStagingBanner } from './ui/components/stagingBanner.ui.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

export async function refreshAllStagedViews() {
    try {
        const results = await Promise.all([
            apiRequest('get_transactions_with_staging'),
            apiRequest('get_dividends_with_staging'),
            apiRequest('get_splits_with_staging'),
            apiRequest('get_groups_with_staging')
        ]);

        const [transactionsResult, dividendsResult, splitsResult, groupsResult] = results;
        const hasStagedChanges = results.some(r => r.success && r.data.hasStagedChanges);

        // ========================= 【核心修正 - 開始】 =========================
        setState(prevState => ({
            ...prevState,
            transactions: transactionsResult.success ? transactionsResult.data.transactions : prevState.transactions,
            confirmedDividends: dividendsResult.success ? dividendsResult.data.dividends : prevState.confirmedDividends,
            userSplits: splitsResult.success ? splitsResult.data.splits : prevState.userSplits,
            groups: groupsResult.success ? groupsResult.data.groups : prevState.groups,
            hasStagedChanges
        }));
        // ========================= 【核心修正 - 結束】 =========================

        const activeTab = document.querySelector('.tab-item.active')?.dataset.tab || 'dashboard';
        
        if (activeTab === 'transactions') renderTransactionsTable();
        if (activeTab === 'dividends') renderDividendsManagementTab(getState().pendingDividends, getState().confirmedDividends);
        if (activeTab === 'splits') renderSplitsTable();
        if (activeTab === 'groups') renderGroupsTab();
        
        renderHoldingsTable(getState().holdings);
        
        updateStagingBanner();

    } catch (error) {
        showNotification('error', `刷新暫存視圖失敗: ${error.message}`);
    }
}

export function updateAppWithData(portfolioData, seriesName = '投資組合') {
    // ... Omitted for brevity
}

async function loadChartDataInBackground() {
    try {
        const result = await apiRequest('get_chart_data', {});
        if (result.success) {
            // ========================= 【核心修正 - 開始】 =========================
            setState(prevState => ({
                ...prevState,
                portfolioHistory: result.data.portfolioHistory || {},
                twrHistory: result.data.twrHistory || {},
                benchmarkHistory: result.data.benchmarkHistory || {},
                netProfitHistory: result.data.netProfitHistory || {}
            }));
            // ========================= 【核心修正 - 結束】 =========================
            
            const { summary } = getState();
            updateAssetChart();
            updateTwrChart(summary?.benchmarkSymbol || 'SPY');
            updateNetProfitChart();
            // ... Omitted for brevity ...
        }
    } catch (error) {
        showNotification('error', '背景圖表數據載入失敗。');
    }
}

export async function loadInitialDashboard() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loadingText.textContent = '正在從雲端同步資料...';
    loadingOverlay.style.display = 'flex';

    try {
        const [summaryResult, holdingsResult, stagedDataResult] = await Promise.all([
            apiRequest('get_dashboard_summary', {}),
            apiRequest('get_holdings', {}),
            Promise.all([
                apiRequest('get_transactions_with_staging'),
                apiRequest('get_dividends_with_staging'),
                apiRequest('get_splits_with_staging'),
                apiRequest('get_groups_with_staging')
            ])
        ]);

        if (!summaryResult.success || !holdingsResult.success) {
            throw new Error('無法載入核心儀表板或持股數據。');
        }

        const { summary } = summaryResult.data;
        const { holdings } = holdingsResult.data;
        const [txs, divs, splits, groups] = stagedDataResult;
        
        const hasStagedChanges = stagedDataResult.some(r => r.success && r.data.hasStagedChanges);

        const holdingsObject = (holdings || []).reduce((obj, item) => { obj[item.symbol] = item; return obj; }, {});
        
        const stockNotes = getState().stockNotes || {};

        // ========================= 【核心修正 - 開始】 =========================
        setState(prevState => ({
            ...prevState,
            summary,
            holdings: holdingsObject,
            stockNotes,
            transactions: txs.success ? txs.data.transactions : [],
            confirmedDividends: divs.success ? divs.data.dividends : [],
            userSplits: splits.success ? splits.data.splits : [],
            groups: groups.success ? groups.data.groups : [],
            hasStagedChanges,
            pendingDividends: divs.success ? divs.data.pendingDividends : []
        }));
        // ========================= 【核心修正 - 結束】 =========================

        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        updateStagingBanner();
        document.getElementById('benchmark-symbol-input').value = summary?.benchmarkSymbol || 'SPY';

        setTimeout(() => {
            loadChartDataInBackground();
        }, 100);

    } catch (error) {
        showNotification('error', `讀取儀表板數據失敗: ${error.message}`);
    } finally {
        loadingOverlay.style.display = 'none';
    }
}

export async function loadAndShowDividends() {
    const { pendingDividends, confirmedDividends } = getState();
    if (pendingDividends && confirmedDividends) {
         renderDividendsManagementTab(pendingDividends, confirmedDividends);
         return;
    }
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';
    try {
        const result = await apiRequest('get_dividends_for_management', {});
        if (result.success) {
            // ========================= 【核心修正 - 開始】 =========================
            setState(prevState => ({
                ...prevState,
                pendingDividends: result.data.pendingDividends,
                confirmedDividends: result.data.confirmedDividends,
            }));
            // ========================= 【核心修正 - 結束】 =========================
            renderDividendsManagementTab(result.data.pendingDividends, result.data.confirmedDividends);
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        showNotification('error', `讀取配息資料失敗: ${error.message}`);
    } finally {
        overlay.style.display = 'none';
    }
}

export function startLiveRefresh() { /* ... Omitted for brevity ... */ }
export function stopLiveRefresh() { /* ... Omitted for brevity ... */ }

export function initializeAppUI() {
    if (getState().isAppInitialized) return;
    console.log("Initializing Main App UI...");
    initializeAssetChart();
    initializeTwrChart();
    initializeNetProfitChart();
    loadGroups();
    initializeTransactionEventListeners();
    initializeSplitEventListeners();
    initializeDividendEventListeners();
    initializeGeneralEventListeners();
    initializeGroupEventListeners();
    initializeStagingEventListeners();
    lucide.createIcons();
    // ========================= 【核心修正 - 開始】 =========================
    setState(prevState => ({ ...prevState, isAppInitialized: true }));
    // ========================= 【核心修正 - 結束】 =========================
}
