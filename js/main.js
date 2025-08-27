// =========================================================================================
// == 主程式進入點 (main.js) v6.2 - Robust Initialization
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, applyGroupView, fetchAllCoreData } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';
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

async function refreshCoreData() {
    try {
        const [summaryRes, holdingsRes] = await Promise.all([
            apiRequest('get_dashboard_summary', {}),
            apiRequest('get_holdings', {})
        ]);

        if (!summaryRes.success || !holdingsRes.success) {
            console.error("Live refresh failed: One or more API calls were unsuccessful.");
            return;
        }

        const { summary } = summaryRes.data;
        const { holdings } = holdingsRes.data;
        
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
                 refreshCoreData();
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

export async function loadInitialData() {
    try {
        await fetchAllCoreData();
        preloadSecondaryData();
    } catch (error) {
        showNotification('error', `讀取初始數據失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

async function preloadSecondaryData() {
    console.log("正在背景預載次要數據 (交易紀錄、配息等)...");
    
    try {
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
    } catch (error) {
        console.warn("背景預載次要數據時發生錯誤:", error);
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

    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            
            if (tabName === 'dividends') {
                await loadAndShowDividends();
            } else if (tabName === 'transactions') {
                await loadTransactionsData();
            } else if (tabName === 'groups') {
                renderGroupsTab();
            } else if (tabName === 'splits') {
                const { userSplits } = getState();
                if (userSplits && userSplits.length > 0) {
                    renderSplitsTable();
                } else {
                    await loadTransactionsData(); 
                }
            }
        }
    });
    
    document.getElementById('currency').addEventListener('change', async () => {
        const { toggleOptionalFields } = await import('./ui/modals.js');
        toggleOptionalFields();
    });
}

export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");
    
    stagingService.init();

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
    
    // ========================= 【核心修改 - 開始】 =========================
    // 對外部函式庫的呼叫進行防禦性處理
    try {
        if (window.lucide) {
            lucide.createIcons();
        } else {
            console.warn("Lucide icon library not loaded.");
        }
    } catch (error) {
        console.error("Error creating Lucide icons:", error);
        // 即使圖示出錯，也不應中斷整個應用的初始化
    }
    // ========================= 【核心修改 - 結束】 =========================

    setState({ isAppInitialized: true });
}

function handleLoginSuccess(user) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    document.getElementById('auth-container').style.display = 'none';
    document.querySelector('main').classList.remove('hidden');
    document.getElementById('logout-btn').style.display = 'block';
    document.getElementById('user-info').classList.remove('hidden');
    document.getElementById('user-id').textContent = user.email;
    document.getElementById('auth-status').textContent = '已連線';
    
    initializeAppUI();
    
    loadingText.textContent = '正在讀取核心資產數據...';
    loadingOverlay.style.display = 'flex';
    loadInitialData();

    startLiveRefresh();
}

function handleLogoutSuccess() {
    const loadingOverlay = document.getElementById('loading-overlay');

    document.getElementById('auth-container').classList.remove('hidden'); 
    document.querySelector('main').classList.add('hidden');
    document.getElementById('logout-btn').style.display = 'none';
    document.getElementById('user-info').classList.add('hidden');

    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
    
    stopLiveRefresh();
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth({
        onLogin: handleLoginSuccess,
        onLogout: handleLogoutSuccess,
    }); 
});
