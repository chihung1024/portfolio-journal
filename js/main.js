// =========================================================================================
// == 主程式進入點 (main.js) v5.3.0 - Note Feature Removed
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, applyGroupView } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';
// 【核心修改】引入暫存區相關模組
import { stagingService } from './staging.service.js';
import { initializeStagingEventListeners } from './events/staging.events.js';


// --- UI Module Imports ---
import { initializeAssetChart, updateAssetChart } from './ui/charts/assetChart.js';
import { initializeTwrChart, updateTwrChart } from './ui/charts/twrChart.js';
import { initializeNetProfitChart, updateNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderDividendsManagementTab } from './ui/components/dividends.ui.js';
import { renderHoldingsTable } from './ui/components/holdings.ui.js';
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js';
// ========================= 【核心修改 - 開始】 =========================
import { renderClosedPositionsTable } from './ui/components/closedPositions.ui.js';
// ========================= 【核心修改 - 結束】 =========================
import { updateDashboard } from './ui/dashboard.js';
import { showNotification } from './ui/notifications.js';
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { getDateRangeForPreset } from './ui/utils.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
// ========================= 【核心修改 - 開始】 =========================
import { initializeClosedPositionEventListeners } from './events/closed_positions.events.js';
// ========================= 【核心修改 - 結束】 =========================
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
        // ========================= 【核心修改 - 開始】 =========================
        // 1. 檢查暫存區是否有待辦事項
        const stagedActions = await stagingService.getStagedActions();
        if (stagedActions.length > 0) {
            console.log("Staging area is not empty, skipping live refresh.");
            return;
        }
        // ========================= 【核心修改 - 結束】 =========================
        
        const { selectedGroupId } = getState();
        if (selectedGroupId !== 'all') {
            console.log(`正在檢視群組 ${selectedGroupId}，跳過自動刷新。`);
            return;
        }
        
        const { openModal } = await import('./ui/modals.js');
        const isModalOpen = document.querySelector('#transaction-modal:not(.hidden)') ||
                            document.querySelector('#split-modal:not(.hidden)') ||
                            document.querySelector('#dividend-modal:not(.hidden)') ||
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


export async function loadInitialDashboard() {
    try {
        const result = await apiRequest('get_dashboard_summary', {});
        if (!result.success) throw new Error(result.message);

        // ========================= 【核心修改 - 開始】 =========================
        const { summary } = result.data;
        
        setState({
            holdings: {},
            summary: summary
        });
        // ========================= 【核心修改 - 結束】 =========================

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

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【新增】載入並顯示平倉紀錄的函式
 */
async function loadAndShowClosedPositions() {
    const { selectedGroupId } = getState();
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';

    try {
        // 向後端請求數據，同時傳遞當前選擇的 groupId
        const result = await apiRequest('get_closed_positions', { groupId: selectedGroupId });
        if (result.success) {
            // 將獲取的數據存入 state
            setState({
                closedPositions: result.data,
                activeClosedPosition: null // 每次刷新都重置展開狀態
            });
            // 呼叫 UI 模組進行渲染
            renderClosedPositionsTable();
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        showNotification('error', `讀取平倉紀錄失敗: ${error.message}`);
    } finally {
        overlay.style.display = 'none';
    }
}
// ========================= 【核心修改 - 結束】 =========================


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
            
            const { transactions, pendingDividends, confirmedDividends, userSplits } = getState();

            // ========================= 【核心修改 - 開始】 =========================
            if (tabName === 'closed-positions') {
                await loadAndShowClosedPositions();
            } else if (tabName === 'dividends') {
            // ========================= 【核心修改 - 結束】 =========================
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

    // ========================= 【核心修改 - 開始】 =========================
    // 移除此處的 group-selector 事件監聽器，因为它已在 group.events.js 中被正確地、
    // 且帶有暫存區檢查邏輯地實現了。保留此處會導致邏輯衝突和 Bug。
    /*
    const groupSelector = document.getElementById('group-selector');
    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        if (selectedGroupId === 'all') {
            document.getElementById('loading-overlay').style.display = 'flex';
            loadInitialDashboard(); 
        } else {
            applyGroupView(selectedGroupId);
        }
    });
    */
    // ========================= 【核心修改 - 結束】 =========================

}

export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");
    
    // 【核心修改】初始化暫存區服務
    stagingService.init();

    initializeAssetChart();
    initializeTwrChart();
    initializeNetProfitChart();
    
    loadGroups();
    
    setupMainAppEventListeners();
    initializeTransactionEventListeners();
    initializeSplitEventListeners();
    initializeDividendEventListeners();
    // ========================= 【核心修改 - 開始】 =========================
    initializeClosedPositionEventListeners();
    // ========================= 【核心修改 - 結束】 =========================
    initializeGeneralEventListeners();
    initializeGroupEventListeners();
    // 【核心修改】初始化暫存區相關的事件監聽
    initializeStagingEventListeners();
    
    lucide.createIcons();

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
