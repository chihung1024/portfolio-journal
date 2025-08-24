// =========================================================================================
// == 主程式進入點 (main.js) v5.0.0 - 支援細粒度與非同步數據流
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, applyGroupView, loadPortfolioData } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';

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
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { getDateRangeForPreset } from './ui/utils.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

let liveRefreshInterval = null;

async function refreshDashboardAndHoldings() {
    // 【核心修改】這個輕量級刷新函式現在只在 'all' 視圖下，且沒有主要數據加載時執行
    const { selectedGroupId, isLoading } = getState();
    if (selectedGroupId !== 'all' || isLoading.holdings || isLoading.summary) {
        console.log("Skipping live refresh due to active loading or group view.");
        return;
    }

    try {
        const result = await apiRequest('get_dashboard_and_holdings', {});
        if (!result.success) return;

        const { summary, holdings, stockNotes } = result.data;
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
        
        const stockNotesMap = (stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note;
            return map;
        }, {});

        setState({
            holdings: holdingsObject,
            summary: summary,
            stockNotes: stockNotesMap,
        });

        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        console.log("Live refresh complete.");

    } catch (error) {
         if (error.message !== 'Aborted') {
            console.error("Live refresh failed:", error);
        }
    }
}

export function startLiveRefresh() {
    stopLiveRefresh();

    const poll = async () => {
        const { selectedGroupId, isLoading } = getState();
        if (selectedGroupId !== 'all') {
            console.log(`正在檢視群組 ${selectedGroupId}，跳過自動刷新。`);
            return;
        }

        // 【新增】如果正在進行其他提交操作，則跳過
        if (isLoading.committing) {
            console.log("An API action is in progress, skipping live refresh.");
            return;
        }

        const isModalOpen = document.querySelector('#transaction-modal:not(.hidden)') ||
                            document.querySelector('#split-modal:not(.hidden)') ||
                            document.querySelector('#dividend-modal:not(.hidden)') ||
                            document.querySelector('#notes-modal:not(.hidden)') ||
                            document.querySelector('#details-modal:not(.hidden)') ||
                            document.querySelector('#group-modal:not(.hidden)');

        if (isModalOpen) {
            console.log("A modal is open, skipping live refresh to avoid interruption.");
            return;
        }

        const now = new Date();
        const taipeiHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getHours();
        const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getDay();

        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            const isTwMarketOpen = taipeiHour >= 9 && taipeiHour < 14;
            const isUsMarketOpen = taipeiHour >= 21 || taipeiHour < 4;

            if (isTwMarketOpen || isUsMarketOpen) {
                 console.log("Market is open. Refreshing data...");
                 refreshDashboardAndHoldings();
            }
        }
    };

    liveRefreshInterval = setInterval(poll, 60000);
}

export function stopLiveRefresh() {
    if (liveRefreshInterval) {
        clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
        console.log("Live refresh stopped.");
    }
}


/**
 * 【核心重構】此函式現在只負責載入次要數據，或在需要時觸發
 */
async function loadSecondaryDataIfNeeded() {
    const { transactions, pendingDividends, confirmedDividends, userSplits } = getState();
    
    // 檢查是否已載入過
    if (transactions.length > 0 || pendingDividends.length > 0 || confirmedDividends.length > 0 || userSplits.length > 0) {
        renderTransactionsTable();
        renderSplitsTable();
        renderDividendsManagementTab(pendingDividends, confirmedDividends);
        return;
    }
    
    // 【修改】使用細粒度狀態
    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.style.display = 'flex';
    setState({ isLoading: { ...getState().isLoading, secondaryData: true } });

    try {
        const results = await Promise.all([
            apiRequest('get_transactions_and_splits', {}),
            apiRequest('get_dividends_for_management', {})
        ]);

        if (results[0] && results[0].success) {
            setState({
                transactions: results[0].data.transactions || [],
                userSplits: results[0].data.splits || [],
            });
            renderTransactionsTable();
            renderSplitsTable();
        }
        
        if (results[1] && results[1].success) {
            setState({
                pendingDividends: results[1].data.pendingDividends || [],
                confirmedDividends: results[1].data.confirmedDividends,
            });
            renderDividendsManagementTab(results[1].data.pendingDividends, results[1].data.confirmedDividends);
        }
    } catch (error) {
        if (error.message !== 'Aborted') {
            showNotification('error', `讀取次要數據失敗: ${error.message}`);
        }
    } finally {
        setState({ isLoading: { ...getState().isLoading, secondaryData: false } });
        loadingOverlay.style.display = 'none';
    }
}


function setupCommonEventListeners() {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('confirm-cancel-btn').addEventListener('click', async () => {
        const { hideConfirm } = await import('./ui/modals.js');
        hideConfirm();
    });
    document.getElementById('confirm-ok-btn').addEventListener('click', async () => {
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); }
        const { hideConfirm } = await import('./ui/modals.js');
        hideConfirm();
    });
}

function setupMainAppEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);

            if (tabName === 'transactions' || tabName === 'dividends' || tabName === 'splits') {
                await loadSecondaryDataIfNeeded();
            } else if (tabName === 'groups') {
                renderGroupsTab();
            }
        }
    });

    document.getElementById('currency').addEventListener('change', async () => {
        const { toggleOptionalFields } = await import('./ui/modals.js');
        toggleOptionalFields();
    });

    const groupSelector = document.getElementById('group-selector');

    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        // 【修改】所有邏輯都已移至 api.js 中的 applyGroupView 和 loadPortfolioData
        if (selectedGroupId === 'all') {
            loadPortfolioData();
        } else {
            applyGroupView(selectedGroupId);
        }
    });
}

export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");

    initializeAssetChart();
    initializeTwrChart();
    initializeNetProfitChart();

    loadGroups();

    setupMainAppEventListeners();
    initializeTransactionEventListeners();
    initializeSplitEventListeners();
    initializeDividendEventListeners();
    initializeGeneralEventListeners();
    initializeGroupEventListeners();
    lucide.createIcons();

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    // 【修改】移除 loading-overlay 的直接控制，交給 auth 模組
    setupCommonEventListeners();
    initializeAuth();
});
