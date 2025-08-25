// =========================================================================================
// == App Core Control (app.js) v1.4 - Fix Export Error
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
    // ... Omitted for brevity
}

async function loadHoldingsInBackground() { /* ... Omitted for brevity ... */ }
async function loadChartDataInBackground() { /* ... Omitted for brevity ... */ }

export async function loadInitialDashboard() {
    // ... Omitted for brevity
}

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【新增】載入並顯示配息管理分頁
 */
export async function loadAndShowDividends() {
    const { pendingDividends, confirmedDividends } = getState();
    // 如果 state 中已有資料，直接渲染，避免不必要的 API 請求
    if (pendingDividends && confirmedDividends) {
         renderDividendsManagementTab(pendingDividends, confirmedDividends);
         return;
    }

    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';
    try {
        // 首次點擊時，從後端獲取一次「待確認」配息列表
        const result = await apiRequest('get_dividends_for_management', {});
        if (result.success) {
            setState({
                pendingDividends: result.data.pendingDividends,
                confirmedDividends: result.data.confirmedDividends, // 同時更新已確認列表
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
// ========================= 【核心修改 - 結束】 =========================

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
