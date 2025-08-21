// =========================================================================================
// == 主程式進入點 (main.js) v6.0.1 - ATLAS-COMMIT Architecture (Full Version)
// =========================================================================================

import { getState, setState } from './state.js';
// [核心修改] 引入新的和保留的 API 函式
import { 
    getTransactionsWithStaging,
    commitAllChanges,
    revertStagedChange, // 暫未使用，為未來捨棄單筆預留
    hydrateAppState, 
    loadPortfolioData,
    applyGroupView,
    getSystemHealth,
    apiRequest // 舊函式中可能會用到
} from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';

// --- UI Module Imports ---
import { initializeAssetChart } from './ui/charts/assetChart.js';
import { initializeTwrChart } from './ui/charts/twrChart.js';
import { initializeNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderDividendsManagementTab } from './ui/components/dividends.ui.js';
import { renderHoldingsTable } from './ui/components/holdings.ui.js';
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js';
import { updateDashboard } from './ui/dashboard.js';
import { showNotification } from './ui/notifications.js';
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';


// [移除] Live Refresh 相關邏輯，因其與暫存區模型衝突
// let liveRefreshInterval = null;
// function refreshDashboardAndHoldings() { ... }
// export function startLiveRefresh() { ... }
// export function stopLiveRefresh() { ... }

/**
 * [新增] 更新全局橫幅的顯示狀態
 */
function updateStagingBanner() {
    const { hasStagedChanges, transactions } = getState();
    const banner = document.getElementById('staging-banner');
    const bannerText = document.getElementById('staging-banner-text');

    const stagedCount = transactions.filter(t => t.status && t.status !== 'COMMITTED').length;

    if (hasStagedChanges && stagedCount > 0) {
        bannerText.textContent = `您有 ${stagedCount} 項未提交的變更。`;
        banner.classList.remove('hidden');
        lucide.createIcons();
    } else {
        banner.classList.add('hidden');
    }
}

/**
 * [新增] 全局刷新函式，用於獲取最新暫存態並更新 UI
 */
export async function refreshStagedView() {
    const data = await getTransactionsWithStaging();
    if (data) {
        setState({
            transactions: data.transactions,
            hasStagedChanges: data.hasStagedChanges
        });
        renderTransactionsTable();
        updateStagingBanner();
    }
}

/**
 * [新增] 系統健康檢查
 */
async function checkSystemHealth() {
    const health = await getSystemHealth();
    if (health && health.lastSnapshotDate) {
        const lastDate = new Date(health.lastSnapshotDate);
        const today = new Date();
        const daysDiff = (today - lastDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 8) {
            showNotification('info', '系統維護可能已延遲，部分操作回應可能較慢。');
        }
    }
}

// [移除] 舊的、分階段的數據載入流程
// export async function loadInitialDashboard() { ... }
// async function loadHoldingsInBackground() { ... }
// async function loadChartDataInBackground() { ... }
// async function loadSecondaryDataInBackground() { ... }


// [修改] 此函式現在主要用於按需加載，核心載入由 onLoginSuccess 處理
async function loadTransactionsData() {
    const { transactions } = getState();
    // 如果 state 中已有數據 (無論是來自初始載入還是暫存刷新)，直接渲染
    if (transactions && transactions.length > 0) {
        renderTransactionsTable();
        return;
    }
    // 否則，執行一次刷新
    await refreshStagedView();
}

// [修改] 此函式現在主要用於按需加載
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

// [維持不變] 登入前即可使用的通用事件監聽
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

// [修改] 登入後的主應用程式事件監聽
function setupMainAppEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            
            if (tabName === 'transactions') {
                await refreshStagedView();
            } else if (tabName === 'dividends') {
                await loadAndShowDividends();
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

    document.getElementById('group-selector').addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        if (selectedGroupId === 'all') {
            document.getElementById('loading-overlay').style.display = 'flex';
            loadPortfolioData().then(() => refreshStagedView());
        } else {
            applyGroupView(selectedGroupId);
        }
    });

    // [新增] 暫存區橫幅的事件監聽
    document.getElementById('commit-btn').addEventListener('click', commitAllChanges);

    document.getElementById('revert-all-btn').addEventListener('click', async () => {
        const { showConfirm } = await import('./ui/modals.js');
        const { transactions } = getState();
        const stagedCount = transactions.filter(t => t.status && t.status !== 'COMMITTED').length;
        if (stagedCount === 0) {
            showNotification('info', '沒有可以捨棄的變更。');
            return;
        }

        showConfirm(`您確定要捨棄所有 ${stagedCount} 項未提交的變更嗎？此操作無法復原。`, () => {
             // 重新載入頁面是清除所有樂觀更新狀態並從後端重新獲取的最可靠方法
             window.location.reload();
        });
    });
}

/**
 * [修改] 應用程式 UI 初始化
 */
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

/**
 * [新增] 應用程式登入成功後的主流程函式
 */
export async function onLoginSuccess() {
    // 1. 初始化 UI 元件和事件監聽
    initializeAppUI();

    // 2. 載入初始的、已確認的 portfolio 數據 (儀表板、圖表、持股等)
    await loadPortfolioData();

    // 3. 在背景檢查並刷新暫存區狀態
    await refreshStagedView();

    // 4. 在背景執行一次系統健康檢查
    checkSystemHealth();
}

// 應用程式啟動入口
document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    // 初始化認證流程，它將在內部處理登入成功後的回調
    initializeAuth(); 
});
