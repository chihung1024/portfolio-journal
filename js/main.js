// =========================================================================================
// == 主程式進入點 (main.js) v6.0 - Final Cleanup
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, applyGroupView } from './api.js';
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
import { initializeStagingEventListeners, updateStagingBanner } from './ui/components/stagingBanner.ui.js';


// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

let liveRefreshInterval = null;

async function refreshDashboardAndHoldings() {
    try {
        const result = await apiRequest('get_dashboard_and_holdings', {});
        if (!result.success) return;

        const { summary, holdings, stockNotes } = result.data;
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
         const stockNotesMap = (stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note; return map;
        }, {});

        setState({
            holdings: holdingsObject,
            summary: summary,
            stockNotes: stockNotesMap
        });

        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        console.log("Live refresh complete.");

    } catch (error) {
        console.error("Live refresh failed:", error);
    }
}

export function startLiveRefresh() {
    stopLiveRefresh(); 

    const poll = async () => {
        const { selectedGroupId, hasStagedChanges } = getState();
        if (selectedGroupId !== 'all' || hasStagedChanges) {
            console.log(`正在檢視群組或有暫存變更，跳過自動刷新。`);
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
    poll();
}

export function stopLiveRefresh() {
    if (liveRefreshInterval) {
        clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
        console.log("Live refresh stopped.");
    }
}


/**
 * 【正式名稱】刷新所有包含暫存狀態的視圖
 * 職責：作為暫存操作後唯一的全局刷新函式。
 */
export async function refreshAllStagedViews() {
    await loadInitialDashboard();
}


export async function loadInitialDashboard() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loadingText.textContent = '正在從雲端同步資料...';
    loadingOverlay.style.display = 'flex';

    try {
        const [summaryResult, holdingsResult, allStagedEntitiesResult] = await Promise.all([
            apiRequest('get_dashboard_summary', {}),
            apiRequest('get_holdings', {}),
            apiRequest('get_all_entities_with_staging', {}) 
        ]);

        if (!summaryResult.success || !holdingsResult.success || !allStagedEntitiesResult.success) {
            throw new Error('無法載入核心儀表板或持股數據。');
        }

        const { summary, stockNotes } = summaryResult.data;
        const { holdings } = holdingsResult.data;
        const { transactions, splits, dividends, hasStagedChanges } = allStagedEntitiesResult.data;
        
        const holdingsObject = (holdings || []).reduce((obj, item) => { obj[item.symbol] = item; return obj; }, {});
        const stockNotesMap = (stockNotes || []).reduce((map, note) => { map[note.symbol] = note; return map; }, {});

        setState({
            summary,
            holdings: holdingsObject,
            stockNotes: stockNotesMap,
            transactions: transactions || [],
            userSplits: splits || [],
            pendingDividends: [], 
            confirmedDividends: dividends || [],
            hasStagedChanges,
        });

        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        renderTransactionsTable();
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


async function loadChartDataInBackground() {
    try {
        console.log("正在背景載入圖表數據...");
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
            
            console.log("圖表數據與日期範圍載入完成。");
            
        }
    } catch (error) {
        console.error('背景載入圖表數據失敗:', error);
        showNotification('error', '背景圖表數據載入失敗，部分圖表可能無法顯示。');
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
            
            if (tabName === 'dividends') {
                const dividendEvents = await import('./events/dividend.events.js');
                await dividendEvents.loadAndShowDividends();
            } else if (tabName === 'transactions') {
                renderTransactionsTable();
            } else if (tabName === 'groups') {
                renderGroupsTab();
            } else if (tabName === 'splits') {
                renderSplitsTable();
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

        if (selectedGroupId === 'all') {
            loadInitialDashboard();
        } else {
            applyGroupView(selectedGroupId);
        }
    });
}

export function initializeAppUI() {
    if (getState().isAppInitialized) return;
    
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
    initializeStagingEventListeners();

    lucide.createIcons();

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});