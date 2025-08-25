// =========================================================================================
// == 主程式進入點 (main.js) v5.1.0 - Fix Circular Dependency
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, applyGroupView, loadInitialData } from './api.js';
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

        const { summary, holdings } = result.data;
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});

        setState({
            holdings: holdingsObject,
            summary: summary
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
        const { selectedGroupId } = getState();
        if (selectedGroupId !== 'all') {
            console.log(`正在檢視群組 ${selectedGroupId}，跳過自動刷新。`);
            return;
        }
        
        const { openModal } = await import('./ui/modals.js');
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
 * 第一階段：載入儀表板摘要與包含暫存狀態的交易列表
 */
export async function loadInitialDashboard() {
    try {
        await loadInitialData(); 
        
        const result = await apiRequest('get_dashboard_summary', {});
        if (!result.success) throw new Error(result.message);

        const { summary, stockNotes } = result.data;
        
        const stockNotesMap = (stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note; return map;
        }, {});

        setState({
            holdings: {},
            stockNotes: stockNotesMap,
            summary: summary
        });

        updateDashboard({}, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable({});
        document.getElementById('benchmark-symbol-input').value = summary?.benchmarkSymbol || 'SPY';

    } catch (error) {
        showNotification('error', `讀取核心數據失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        setTimeout(() => {
            loadHoldingsInBackground();
            loadChartDataInBackground();
        }, 100);
    }
}

/**
 * 第二階段：在背景載入持股列表
 */
async function loadHoldingsInBackground() {
    try {
        console.log("正在背景載入持股數據...");
        const result = await apiRequest('get_holdings', {});
        if (result.success) {
            const { holdings } = result.data;
            const holdingsObject = (holdings || []).reduce((obj, item) => {
                obj[item.symbol] = item; return obj;
            }, {});
            
            setState({ holdings: holdingsObject });
            
            const { summary } = getState();
            updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
            renderHoldingsTable(holdingsObject);
            console.log("持股數據載入完成。");
        }
    } catch (error) {
        console.error('背景載入持股數據失敗:', error);
        showNotification('error', '持股列表載入失敗。');
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
            
            loadSecondaryDataInBackground();

        }
    } catch (error) {
        console.error('背景載入圖表數據失敗:', error);
        showNotification('error', '背景圖表數據載入失敗，部分圖表可能無法顯示。');
    }
}

async function loadSecondaryDataInBackground() {
    console.log("正在背景預載次要數據 (配息等)...");
    
    const results = await Promise.allSettled([
        apiRequest('get_dividends_for_management', {})
    ]);

    if (results[0].status === 'fulfilled' && results[0].value.success) {
        setState({
            pendingDividends: results[0].value.data.pendingDividends,
            confirmedDividends: results[0].value.data.confirmedDividends,
        });
        console.log("配息數據預載完成。");
    } else {
        console.error("預載配息資料失敗:", results[0].reason || results[0].value.message);
    }
}


async function loadTransactionsData() {
    const { transactions } = getState();
    if (transactions && transactions.length > 0) {
        renderTransactionsTable();
        return;
    }
    await loadInitialData();
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
            
            const { pendingDividends, confirmedDividends, userSplits } = getState();

            if (tabName === 'dividends') {
                await loadAndShowDividends();
            } else if (tabName === 'transactions') {
                await loadTransactionsData();
            } else if (tabName === 'groups') {
                renderGroupsTab();
            } else if (tabName === 'splits') {
                if(userSplits) {
                    renderSplitsTable();
                }
            }
        }
    });
    
    document.getElementById('currency').addEventListener('change', async () => {
        const { toggleOptionalFields } = await import('./ui/modals.js');
        toggleOptionalFields();
    });

    const groupSelector = document.getElementById('group-selector');

    // ========================= 【核心修改 - 開始】 =========================
    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });

        if (selectedGroupId === 'all') {
            // 切換回「全部股票」時，呼叫初始載入函式
            loadInitialDashboard();
        } else {
            // 切換到特定群組時，呼叫群組計算函式
            applyGroupView(selectedGroupId);
        }
    });
    // ========================= 【核心修改 - 結束】 =========================
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
    initializeStagingEventListeners();

    lucide.createIcons();

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
