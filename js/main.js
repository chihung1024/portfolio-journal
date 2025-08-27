// =========================================================================================
// == 主程式進入點 (main.js) v6.0 - Atomic API Integration
// =========================================================================================

import { getState, setState } from './state.js';
// 【核心修改】引入新的、原子化的 API 請求函式
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

// ========================= 【核心修改 - 開始】 =========================

/**
 * 【重構】即時刷新儀表板和持股的核心數據
 */
async function refreshCoreData() {
    try {
        // 並行請求摘要和持股數據
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
                 refreshCoreData(); // <--- 呼叫新的刷新函式
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
 * 【重構】應用程式啟動時，載入所有核心數據
 */
export async function loadInitialData() {
    try {
        // 呼叫 api.js 中新的、統一的數據獲取函式
        await fetchAllCoreData();
        
        // 在核心數據載入後，非同步、非阻塞地預載次要數據
        preloadSecondaryData();

    } catch (error) {
        showNotification('error', `讀取初始數據失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

/**
 * 【新增】在背景預載次要數據（如交易紀錄），以加速分頁切換體驗
 */
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
        // 預載失敗是可接受的，不打擾使用者
        console.warn("背景預載次要數據時發生錯誤:", error);
    }
}


/**
 * 【廢除】移除 loadInitialDashboard, loadHoldingsInBackground, loadChartDataInBackground, loadSecondaryDataInBackground 等舊函式
 * 它們的職責已被新的 fetchAllCoreData 和 preloadSecondaryData 取代。
 */
// ========================= 【核心修改 - 結束】 =========================


/**
 * 載入交易紀錄數據（如果尚未預載）
 */
async function loadTransactionsData() {
    const { transactions } = getState();
    // 如果 state 中已有數據（來自預載），則直接渲染
    if (transactions && transactions.length > 0) {
        renderTransactionsTable();
        return;
    }
    
    // 如果沒有預載數據，則即時獲取
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

/**
 * 載入並顯示配息管理分頁（如果尚未預載）
 */
export async function loadAndShowDividends() {
    const { pendingDividends, confirmedDividends } = getState();
     // 如果 state 中已有數據（來自預載），則直接渲染
    if (pendingDividends && confirmedDividends) {
         renderDividendsManagementTab(pendingDividends, confirmedDividends);
         return;
    }

    // 如果沒有預載數據，則即時獲取
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
                if (userSplits) {
                    renderSplitsTable();
                } else {
                    // 如果拆股數據也未被預載，可以在此處添加即時獲取邏輯
                    await loadTransactionsData(); // 拆股數據與交易數據一起獲取
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
    
    lucide.createIcons();

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});