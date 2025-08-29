// =========================================================================================
// == 主程式進入點 (main.js) v6.0 (Optimistic Update & Sync Logic)
// =========================================================================================

import { getState, setState } from './state.js';
// 【核心修改】引入新的 fetchAndApplyGlobalData API
import { apiRequest, applyGroupView, fetchAndApplyGlobalData } from './api.js';
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
import { renderClosedPositionsTable } from './ui/components/closedPositions.ui.js';
import { updateDashboard } from './ui/dashboard.js';
import { showNotification } from './ui/notifications.js';
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { getDateRangeForPreset } from './ui/utils.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeClosedPositionEventListeners } from './events/closed_positions.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

let liveRefreshInterval = null;

/**
 * 【重構】背景自動刷新函式，現在也作為後端數據的最終同步觸發器
 */
async function refreshDashboardAndHoldings() {
    const { isSyncing, selectedGroupId } = getState();
    
    // 如果正在進行一次手動或更全面的同步，則跳過此次自動刷新
    if (isSyncing) {
        console.log("An existing data sync is in progress, skipping live refresh.");
        return;
    }

    // 在群組檢視模式下，不進行全局的自動刷新
    if (selectedGroupId !== 'all') {
        console.log(`Group view active (${selectedGroupId}), skipping global live refresh.`);
        return;
    }

    const stagedActions = await stagingService.getStagedActions();
    if (stagedActions.length > 0) {
        console.log("Staging area is not empty, skipping live refresh.");
        return;
    }
    
    // 檢查是否有 Modal 開啟中
    const isModalOpen = document.querySelector('#transaction-modal:not(.hidden)') ||
                        document.querySelector('#split-modal:not(.hidden)') ||
                        document.querySelector('#dividend-modal:not(.hidden)') ||
                        document.querySelector('#details-modal:not(.hidden)') ||
                        document.querySelector('#group-modal:not(.hidden)');

    if (isModalOpen) {
        console.log("A modal is open, skipping live refresh to avoid interruption.");
        return;
    }
    
    // 檢查市場開盤時間
    const now = new Date();
    const taipeiHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getHours();
    const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getDay();

    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const isTwMarketOpen = taipeiHour >= 9 && taipeiHour < 14;
        const isUsMarketOpen = taipeiHour >= 21 || taipeiHour < 4;

        if (isTwMarketOpen || isUsMarketOpen) {
             console.log("Market is open. Fetching latest data from server...");
             // 使用新的統一函式進行背景靜默更新
             await fetchAndApplyGlobalData(false);
             console.log("Live refresh complete.");
        }
    }
}


export function startLiveRefresh() {
    stopLiveRefresh(); 
    liveRefreshInterval = setInterval(refreshDashboardAndHoldings, 60000); 
    // 啟動後立刻執行一次檢查
    refreshDashboardAndHoldings();
}

export function stopLiveRefresh() {
    if (liveRefreshInterval) {
        clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
        console.log("Live refresh stopped.");
    }
}


/**
 * 【重構】應用程式啟動時的初始資料載入流程
 */
export async function loadInitialDashboard() {
    try {
        // 現在，初始載入也直接使用統一的 fetchAndApplyGlobalData 函式
        await fetchAndApplyGlobalData(true);
    } catch (error) {
        showNotification('error', `讀取核心數據失敗: ${error.message}`);
        // 確保即使失敗也要隱藏載入畫面
        document.getElementById('loading-overlay').style.display = 'none';
    }
}


async function loadTransactionsData() {
    const { transactions } = getState();
    if (transactions && transactions.length > 0) {
        await renderTransactionsTable();
        return;
    }
    // 如果 state 中沒有，就觸發一次全局刷新來獲取
    await fetchAndApplyGlobalData(true);
}

export async function loadAndShowDividends() {
    const { pendingDividends, confirmedDividends } = getState();
    if (pendingDividends && confirmedDividends) {
         await renderDividendsManagementTab(pendingDividends, confirmedDividends);
         return;
    }
    // 如果 state 中沒有，就觸發一次全局刷新來獲取
    await fetchAndApplyGlobalData(true);
}

async function loadAndShowClosedPositions() {
    const { selectedGroupId } = getState();
    // 平倉紀錄總是需要根據 group ID 重新請求，因此維持原狀
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';

    try {
        const result = await apiRequest('get_closed_positions', { groupId: selectedGroupId });
        if (result.success) {
            setState({
                closedPositions: result.data,
                activeClosedPosition: null 
            });
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
            
            // 頁籤切換時，根據 state 中是否已有數據來決定是否需要重新載入
            if (tabName === 'closed-positions') {
                await loadAndShowClosedPositions();
            } else if (tabName === 'dividends') {
                await loadAndShowDividends();
            } else if (tabName === 'transactions') {
                await loadTransactionsData();
            } else if (tabName === 'groups') {
                renderGroupsTab();
            } else if (tabName === 'splits') {
                const { userSplits } = getState();
                if(userSplits) {
                    await renderSplitsTable();
                } else {
                    await fetchAndApplyGlobalData(true);
                }
            }
        }
    });
    
    document.getElementById('currency').addEventListener('change', async () => {
        const { toggleOptionalFields } = await import('../ui/modals.js');
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
    initializeClosedPositionEventListeners();
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
