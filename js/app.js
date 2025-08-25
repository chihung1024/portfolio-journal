// =========================================================================================
// == App Core Control (app.js) v1.5 - Robust Initial Load
// == 職責：提供高階的、可重用的應用程式控制函式，打破循環依賴。
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

let liveRefreshInterval = null;

export async function refreshAllStagedViews() {
    try {
        const results = await Promise.all([
            apiRequest('get_transactions_with_staging'),
            apiRequest('get_dividends_with_staging'),
            apiRequest('get_splits_with_staging'),
            apiRequest('get_groups_with_staging'),
            apiRequest('get_notes_with_staging')
        ]);

        const [transactionsResult, dividendsResult, splitsResult, groupsResult, notesResult] = results;
        const hasStagedChanges = results.some(r => r.success && r.data.hasStagedChanges);

        const newStockNotes = notesResult.success ? (notesResult.data.notes || []).reduce((map, note) => {
            map[note.symbol] = note; return map;
        }, {}) : getState().stockNotes;

        setState({
            transactions: transactionsResult.success ? transactionsResult.data.transactions : getState().transactions,
            confirmedDividends: dividendsResult.success ? dividendsResult.data.dividends : getState().confirmedDividends,
            userSplits: splitsResult.success ? splitsResult.data.splits : getState().userSplits,
            groups: groupsResult.success ? groupsResult.data.groups : getState().groups,
            stockNotes: newStockNotes,
            hasStagedChanges
        });

        renderTransactionsTable();
        renderDividendsManagementTab(getState().pendingDividends, getState().confirmedDividends);
        renderSplitsTable();
        renderGroupsTab();
        updateStagingBanner();
        renderHoldingsTable(getState().holdings);

    } catch (error) {
        showNotification('error', `刷新暫存視圖失敗: ${error.message}`);
    }
}

export function updateAppWithData(portfolioData, seriesName = '投資組合') {
    const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => { obj[item.symbol] = item; return obj; }, {});
    const stockNotesMap = (portfolioData.stockNotes || []).reduce((map, note) => { map[note.symbol] = note; return map; }, {});
    
    setState({
        transactions: portfolioData.transactions || getState().transactions,
        userSplits: portfolioData.splits || [],
        stockNotes: stockNotesMap,
        holdings: holdingsObject,
        summary: portfolioData.summary || {},
        portfolioHistory: portfolioData.history || {},
        twrHistory: portfolioData.twrHistory || {},
        benchmarkHistory: portfolioData.benchmarkHistory || {},
        netProfitHistory: portfolioData.netProfitHistory || {},
        assetDateRange: { type: 'all', start: null, end: null },
        twrDateRange: { type: 'all', start: null, end: null },
        netProfitDateRange: { type: 'all', start: null, end: null }
    });
    
    renderHoldingsTable(holdingsObject);
    renderTransactionsTable();
    renderSplitsTable();
    updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);
    
    updateAssetChart(seriesName); 
    updateNetProfitChart(seriesName);
    const benchmarkSymbol = portfolioData.summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol, seriesName);

    document.getElementById('benchmark-symbol-input').value = benchmarkSymbol;
    ['asset', 'twr', 'net-profit'].forEach(chartType => {
        const controls = document.getElementById(`${chartType}-chart-controls`);
        if(controls) {
            controls.querySelectorAll('.chart-range-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.range === 'all') btn.classList.add('active');
            });
            const history = getState()[`${chartType === 'asset' ? 'portfolio' : chartType}History`];
            const dates = getDateRangeForPreset(history, { type: 'all' });
            document.getElementById(`${chartType}-start-date`).value = dates.startDate;
            document.getElementById(`${chartType}-end-date`).value = dates.endDate;
        }
    });
}

async function loadChartDataInBackground() {
    try {
        const result = await apiRequest('get_chart_data', {});
        if (result.success) {
            setState({
                portfolioHistory: result.data.portfolioHistory || {},
                twrHistory: result.data.twrHistory || {},
                benchmarkHistory: result.data.benchmarkHistory || {},
                netProfitHistory: result.data.netProfitHistory || {}
            });
            const { summary, portfolioHistory, twrHistory, netProfitHistory } = getState();
            updateAssetChart();
            updateTwrChart(summary?.benchmarkSymbol || 'SPY');
            updateNetProfitChart();
            const assetDates = getDateRangeForPreset(portfolioHistory, { type: 'all' });
            document.getElementById('asset-start-date').value = assetDates.startDate;
            document.getElementById('asset-end-date').value = assetDates.endDate;
            const twrDates = getDateRangeForPreset(twrHistory, { type: 'all' });
            document.getElementById('twr-start-date').value = twrDates.startDate;
            document.getElementById('twr-end-date').value = twrDates.endDate;
            const netProfitDates = getDateRangeForPreset(netProfitHistory, { type: 'all' });
            document.getElementById('net-profit-start-date').value = netProfitDates.startDate;
            document.getElementById('net-profit-end-date').value = netProfitDates.endDate;
        }
    } catch (error) {
        showNotification('error', '背景圖表數據載入失敗。');
    }
}

// ========================= 【核心修改 - 開始】 =========================
export async function loadInitialDashboard() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loadingText.textContent = '正在從雲端同步資料...';
    loadingOverlay.style.display = 'flex';

    try {
        // 步驟 1: 並行獲取所有儀表板必需的數據
        const [summaryResult, holdingsResult, stagedDataResult] = await Promise.all([
            apiRequest('get_dashboard_summary', {}),
            apiRequest('get_holdings', {}),
            Promise.all([
                apiRequest('get_transactions_with_staging'),
                apiRequest('get_dividends_with_staging'),
                apiRequest('get_splits_with_staging'),
                apiRequest('get_groups_with_staging'),
                apiRequest('get_notes_with_staging')
            ])
        ]);

        if (!summaryResult.success || !holdingsResult.success) {
            throw new Error('無法載入核心儀表板或持股數據。');
        }

        // 步驟 2: 處理並合併所有數據
        const { summary } = summaryResult.data;
        const { holdings } = holdingsResult.data;
        const [txs, divs, splits, groups, notes] = stagedDataResult;
        const hasStagedChanges = stagedDataResult.some(r => r.success && r.data.hasStagedChanges);

        const holdingsObject = (holdings || []).reduce((obj, item) => { obj[item.symbol] = item; return obj; }, {});
        const stockNotes = notes.success ? (notes.data.notes || []).reduce((map, note) => {
            map[note.symbol] = note; return map;
        }, {}) : {};

        // 步驟 3: 一次性更新全局 State
        setState({
            summary,
            holdings: holdingsObject,
            stockNotes,
            transactions: txs.success ? txs.data.transactions : [],
            confirmedDividends: divs.success ? divs.data.dividends : [],
            userSplits: splits.success ? splits.data.splits : [],
            groups: groups.success ? groups.data.groups : [],
            hasStagedChanges,
            pendingDividends: divs.success ? divs.data.pendingDividends : [] // Also update pending from staged result
        });

        // 步驟 4: 一次性渲染所有 UI 元件
        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        renderTransactionsTable();
        renderDividendsManagementTab(getState().pendingDividends, getState().confirmedDividends);
        renderSplitsTable();
        renderGroupsTab();
        updateStagingBanner();
        document.getElementById('benchmark-symbol-input').value = summary?.benchmarkSymbol || 'SPY';

        // 步驟 5: 在背景載入非必要的圖表數據
        setTimeout(() => {
            loadChartDataInBackground();
        }, 100);

    } catch (error) {
        showNotification('error', `讀取儀表板數據失敗: ${error.message}`);
    } finally {
        loadingOverlay.style.display = 'none';
    }
}
// ========================= 【核心修改 - 結束】 =========================

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
            setState({
                pendingDividends: result.data.pendingDividends,
                confirmedDividends: result.data.confirmedDividends,
            });
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
    setState({ isAppInitialized: true });
}