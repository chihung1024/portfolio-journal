// =========================================================================================
// == App Core Control (app.js) v1.3 - Final Staging Integration
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

/**
 * 全局的、統一的暫存視圖刷新函式
 */
export async function refreshAllStagedViews() {
    try {
        // ========================= 【核心修改 - 開始】 =========================
        const results = await Promise.all([
            apiRequest('get_transactions_with_staging'),
            apiRequest('get_dividends_with_staging'),
            apiRequest('get_splits_with_staging'),
            apiRequest('get_groups_with_staging'),
            apiRequest('get_notes_with_staging') // 新增筆記
        ]);

        const [transactionsResult, dividendsResult, splitsResult, groupsResult, notesResult] = results;
        // ========================= 【核心修改 - 結束】 =========================

        const hasStagedChanges = results.some(r => r.success && r.data.hasStagedChanges);

        // ========================= 【核心修改 - 開始】 =========================
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
        // ========================= 【核心修改 - 結束】 =========================

        renderTransactionsTable();
        renderDividendsManagementTab(getState().pendingDividends, getState().confirmedDividends);
        renderSplitsTable();
        renderGroupsTab();
        updateStagingBanner();
        
        // ========================= 【核心修改 - 開始】 =========================
        // 刷新持股列表，以同步筆記等狀態的變更
        renderHoldingsTable(getState().holdings);
        // ========================= 【核心修改 - 結束】 =========================

    } catch (error) {
        showNotification('error', `刷新暫存視圖失敗: ${error.message}`);
    }
}

/**
 * 統一的函式，用來接收【完整】計算結果並更新整個 App 的 UI
 */
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

async function loadHoldingsInBackground() { /* ... Omitted for brevity ... */ }
async function loadChartDataInBackground() { /* ... Omitted for brevity ... */ }

export async function loadInitialDashboard() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loadingText.textContent = '正在讀取核心資產數據...';
    loadingOverlay.style.display = 'flex';
    try {
        await refreshAllStagedViews();
        const result = await apiRequest('get_dashboard_summary', {});
        if (!result.success) throw new Error(result.message);
        const { summary, stockNotes } = result.data;
        const stockNotesMap = (stockNotes || []).reduce((map, note) => { map[note.symbol] = note; return map; }, {});
        setState({ holdings: {}, stockNotes: stockNotesMap, summary: summary });
        updateDashboard({}, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable({});
        document.getElementById('benchmark-symbol-input').value = summary?.benchmarkSymbol || 'SPY';
    } catch (error) {
        showNotification('error', `讀取核心數據失敗: ${error.message}`);
    } finally {
        loadingOverlay.style.display = 'none';
        setTimeout(() => {
            loadHoldingsInBackground();
            loadChartDataInBackground();
        }, 100);
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