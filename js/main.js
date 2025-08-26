// = a======================================================================================
// == 主程式進入點 (main.js) v5.0.0 - 整合操作隊列同步機制
// =========================================================================================

import { getState, setState } from './state.js';
// 【修改】引入 executeSync 和 applyGroupView
import { apiRequest, executeSync, applyGroupView } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';
// 【新增】引入操作隊列管理器
import { initializeSyncStatus } from './op_queue_manager.js';


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
// 【新增】為了清晰起見，將筆記事件監聽器獨立出來
import { initializeNoteEventListeners } from './events/note.events.js';


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
        // 【核心修改】增加條件判斷
        const { selectedGroupId, hasUnsyncedChanges } = getState();
        if (selectedGroupId !== 'all') {
            console.log(`正在檢視群組 ${selectedGroupId}，跳過自動刷新。`);
            return;
        }
        if (hasUnsyncedChanges) {
            console.log(`有未同步的變更，跳過自動刷新以避免衝突。`);
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
 * 【新函式】第一階段：僅載入儀表板摘要
 */
export async function loadInitialDashboard() {
    try {
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
 * 【新函式】第二階段：在背景載入持股列表
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
    console.log("正在背景預載次要數據 (交易紀錄、配息等)...");
    
    const results = await Promise.allSettled([
        apiRequest('get_transactions_and_splits', {}),
        apiRequest('get_dividends_for_management', {})
    ]);

    if (results[0].status === 'fulfilled' && results[0].value.success) {
        setState({
            transactions: results[0].value.data.transactions || [],
            userSplits: results[0].value.data.splits || [],
        });
        console.log("交易與拆股數據預載完成。");
    } else {
        console.error("預載交易紀錄失敗:", results[0].reason || results[0].value.message);
    }
    
    if (results[1].status === 'fulfilled' && results[1].value.success) {
        setState({
            pendingDividends: results[1].value.data.pendingDividends,
            confirmedDividends: results[1].value.data.confirmedDividends,
        });
        console.log("配息數據預載完成。");
    } else {
        console.error("預載配息資料失敗:", results[1].reason || results[1].value.message);
    }
}


async function loadTransactionsData() {
    const { transactions } = getState();
    if (transactions && transactions.length > 0) {
        renderTransactionsTable();
        return;
    }
    
    document.getElementById('loading-overlay').style.display = 'flex';
    try {
        const result = await apiRequest('get_transactions_and_splits', {});
        if (result.success) {
            setState({
                transactions: result.data.transactions || [],
                userSplits: result.data.splits || [],
            });
            renderTransactionsTable();
            renderSplitsTable();
        }
    } catch (error) {
        showNotification('error', `讀取交易紀錄失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
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
    
    // ========================= 【核心修改 - 開始】 =========================
    document.getElementById('sync-changes-btn').addEventListener('click', executeSync);
    // ========================= 【核心修改 - 結束】 =========================

    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            
            const { transactions, pendingDividends, confirmedDividends, userSplits } = getState();

            if (tabName === 'dividends') {
                if (pendingDividends && confirmedDividends) {
                    renderDividendsManagementTab(pendingDividends, confirmedDividends);
                } else {
                    await loadAndShowDividends();
                }
            } else if (tabName === 'transactions') {
                if (transactions.length > 0) {
                    renderTransactionsTable();
                } else {
                    await loadTransactionsData();
                }
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
    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        applyGroupView(selectedGroupId);
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
    initializeNoteEventListeners(); // 【新增】初始化筆記事件
    initializeSyncStatus(); // 【新增】初始化同步按鈕狀態

    lucide.createIcons();

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});