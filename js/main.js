// =========================================================================================
// == 主程式進入點 (main.js) v5.3.0 - Robust Initialization Refactor
// =========================================================================================

import { getState, setState } from './state.js';
// 【修改】applyGroupView 現在從 api.js 導入
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
        // 【修改】API action 'get_dashboard_and_holdings' 已被新的架構棄用，此處保持不變，待後續全局暫存區重構時一併更新
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

// ========================= 【核心 Bug 修復 - 開始】 =========================
/**
 * 【重構】應用程式初始資料載入函式
 * 職責：作為登入後唯一的資料入口點，使用 Promise.all 並行獲取所有核心資料，
 * 確保 UI 渲染前所有必要數據都已到位，從而消除競爭條件。
 */
export async function loadInitialDashboard() {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loadingText.textContent = '正在從雲端同步資料...';
    loadingOverlay.style.display = 'flex';

    try {
        // 使用 Promise.all 並行請求所有必要的初始數據
        const [summaryResult, holdingsResult, allStagedEntitiesResult] = await Promise.all([
            apiRequest('get_dashboard_summary', {}),
            apiRequest('get_holdings', {}),
            // 注意：我們在這裡提前使用下一階段才會正式啟用的 API
            // 這是為了讓 Bug 修復能與即將到來的架構升級無縫接軌
            apiRequest('get_all_entities_with_staging', {}) 
        ]);

        // 檢查所有請求是否成功
        if (!summaryResult.success || !holdingsResult.success || !allStagedEntitiesResult.success) {
            throw new Error('無法載入核心儀表板或持股數據。');
        }

        // 解構所有回傳的資料
        const { summary, stockNotes } = summaryResult.data;
        const { holdings } = holdingsResult.data;
        const { transactions, splits, dividends, hasStagedChanges } = allStagedEntitiesResult.data;
        
        // 將資料整理成 state 需要的格式
        const holdingsObject = (holdings || []).reduce((obj, item) => { obj[item.symbol] = item; return obj; }, {});
        const stockNotesMap = (stockNotes || []).reduce((map, note) => { map[note.symbol] = note; return map; }, {});

        // 一次性更新 state，觸發 UI 重新渲染
        setState({
            summary,
            holdings: holdingsObject,
            stockNotes: stockNotesMap,
            transactions: transactions || [],
            userSplits: splits || [],
            // 注意：dividends 需要拆分為 pending 和 confirmed
            pendingDividends: [], // getAllEntitiesWithStaging 尚未實作 pending，暫時為空
            confirmedDividends: dividends || [],
            hasStagedChanges,
            isAppInitialized: true // 確保只初始化一次
        });

        // 更新 UI 元件
        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        renderTransactionsTable(); // 現在可以安全地渲染交易列表
        updateStagingBanner();
        document.getElementById('benchmark-symbol-input').value = summary?.benchmarkSymbol || 'SPY';

        // 在背景非同步載入較大的圖表數據
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
// ========================= 【核心 Bug 修復 - 結束】 =========================


async function loadTransactionsData() {
    // 這個函式現在可以被簡化，因為初始載入時就會獲取交易數據
    const { transactions } = getState();
    if (transactions) {
        renderTransactionsTable();
    }
}

async function loadAndShowDividends() {
    const { pendingDividends, confirmedDividends } = getState();
    // 檢查 state 中是否已有數據
    if (pendingDividends && confirmedDividends) {
         renderDividendsManagementTab(pendingDividends, confirmedDividends);
         return;
    }
    
    // 如果沒有，則從後端獲取
    try {
        const result = await apiRequest('get_dividends_for_management', {});
        if (result.success) {
            setState({
                pendingDividends: result.data.pendingDividends,
                confirmedDividends: result.data.confirmedDividends,
            });
            renderDividendsManagementTab(result.data.pendingDividends, result.data.confirmedDividends);
        }
    } catch(e) {
        showNotification('error', `讀取配息資料失敗: ${e.message}`);
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
            loadInitialDashboard(); // 切回 'all' 時，重新執行一次完整的 dashboard 載入
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
    initializeStagingEventListeners();

    lucide.createIcons();

    // isAppInitialized 的狀態現在由 loadInitialDashboard 管理，確保在資料載入後才設為 true
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
