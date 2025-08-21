// =========================================================================================
// == 主程式進入點 (main.js) v5.0.0 - (核心重構) 整合 ATLAS-COMMIT 架構
// =========================================================================================

import { getState, setState } from './state.js';
// 【修改】引入 hydrateAppState 和 apiRequest
import { apiRequest, applyGroupView, hydrateAppState } from './api.js';
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
import { closeModal, hideConfirm, openModal, showConfirm } from './ui/modals.js';
import { showNotification } from './ui/notifications.js';
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { getDateRangeForPreset } from './ui/utils.js';
// 【新增】引入 stagingBanner 的更新函式
import { updateStagingBanner } from './ui/components/stagingBanner.ui.js';


// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

let liveRefreshInterval = null;
let healthCheckInterval = null;

/**
 * 【新增】提交所有暫存的變更
 */
async function commitAllChanges() {
    const { hasStagedChanges, isCommitting } = getState();
    if (!hasStagedChanges || isCommitting) return;

    setState({ isCommitting: true });
    updateStagingBanner(); // 更新橫幅為 "提交中..."

    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = '正在同步所有變更至雲端...';
    loadingOverlay.style.display = 'flex';

    try {
        const result = await apiRequest('commit_all_changes', {});
        if (result.success && result.data) {
            // 使用 hydrateAppState 進行權威性刷新
            hydrateAppState(result.data);
            showNotification('success', '所有變更已成功同步！');
        } else {
            throw new Error(result.message || '提交失敗，但未收到明確錯誤訊息。');
        }
    } catch (error) {
        showNotification('error', `提交失敗: ${error.message}`);
        // 如果提交失敗，重設提交狀態，讓使用者可以重試
        setState({ isCommitting: false });
        updateStagingBanner();
    } finally {
        loadingOverlay.style.display = 'none';
        loadingTextElement.textContent = '正在從雲端同步資料...';
    }
}

/**
 * 【新增】啟動系統健康檢查定時器
 */
function startSystemHealthCheck() {
    stopSystemHealthCheck(); // 先停止舊的
    
    const checkHealth = async () => {
        try {
            const result = await apiRequest('get_system_health', {});
            if (result.success && result.data.lastSnapshotDate) {
                const lastDate = new Date(result.data.lastSnapshotDate);
                const daysDiff = (new Date() - lastDate) / (1000 * 60 * 60 * 24);
                if (daysDiff > 10) {
                    showNotification('info', `系統提示：績效快照已超過 ${Math.floor(daysDiff)} 天未更新，建議手動執行週末校驗腳本以維持最佳效能。`);
                }
            }
        } catch (error) {
            console.warn("系統健康檢查失敗:", error);
        }
    };

    healthCheckInterval = setInterval(checkHealth, 300000); // 每 5 分鐘檢查一次
    checkHealth(); // 立即執行一次
}

function stopSystemHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}


// --- 舊有函式，部分邏輯維持不變或微調 ---

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

    } catch (error) {
        console.error("Live refresh failed:", error);
    }
}

export function startLiveRefresh() {
    stopLiveRefresh(); 

    const poll = async () => {
        const { selectedGroupId, hasStagedChanges } = getState();
        // 【修改】如果正在檢視自訂群組，或有待辦事項，則不刷新
        if (selectedGroupId !== 'all' || hasStagedChanges) {
            return;
        }
        
        const isModalOpen = document.querySelector('#transaction-modal:not(.hidden)') ||
                            document.querySelector('#split-modal:not(.hidden)') ||
                            document.querySelector('#dividend-modal:not(.hidden)') ||
                            document.querySelector('#notes-modal:not(.hidden)') ||
                            document.querySelector('#details-modal:not(.hidden)') ||
                            document.querySelector('#group-modal:not(.hidden)');

        if (isModalOpen) return;

        const now = new Date();
        const taipeiHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getHours();
        const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getDay();

        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            const isTwMarketOpen = taipeiHour >= 9 && taipeiHour < 14;
            const isUsMarketOpen = taipeiHour >= 21 || taipeiHour < 4;

            if (isTwMarketOpen || isUsMarketOpen) {
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
    }
}


/**
 * 【維持不變】第一階段：僅載入儀表板摘要
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
 * 【維持不變】第二階段：在背景載入持股列表
 */
async function loadHoldingsInBackground() {
    try {
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
        }
    } catch (error) {
        console.error('背景載入持股數據失敗:', error);
        showNotification('error', '持股列表載入失敗。');
    }
}

// ... 其他載入函式 (loadChartDataInBackground, loadSecondaryDataInBackground) 維持不變 ...
async function loadChartDataInBackground() {
    try {
        const result = await apiRequest('get_chart_data', {});
        if (result.success) {
            setState({
                portfolioHistory: result.data.portfolioHistory || {},
                twrHistory: result.data.twrHistory || {},
                benchmarkHistory: result.data.benchmarkHistory || {},
                netProfitHistory: result.data.netProfitHistory || {}
            });
            updateAssetChart();
            updateTwrChart(getState().summary?.benchmarkSymbol || 'SPY');
            updateNetProfitChart();
            loadSecondaryDataInBackground();
        }
    } catch (error) {
        console.error('背景載入圖表數據失敗:', error);
    }
}

async function loadSecondaryDataInBackground() {
    const results = await Promise.allSettled([
        apiRequest('get_transactions_with_staging', {}), // 【修改】改為呼叫新的 API
        apiRequest('get_dividends_for_management', {})
    ]);

    if (results[0].status === 'fulfilled' && results[0].value.success) {
        const { transactions, hasStagedChanges } = results[0].value.data;
        setState({
            transactions: transactions || [],
            hasStagedChanges: hasStagedChanges,
            stagedChanges: transactions.filter(t => t.status && t.status !== 'COMMITTED') // 預先填充
        });
        updateStagingBanner();
    } else {
        console.error("預載交易紀錄失敗:", results[0].reason || results[0].value.message);
    }
    
    if (results[1].status === 'fulfilled' && results[1].value.success) {
        setState({
            pendingDividends: results[1].value.data.pendingDividends,
            confirmedDividends: results[1].value.data.confirmedDividends,
        });
    } else {
        console.error("預載配息資料失敗:", results[1].reason || results[1].value.message);
    }
}


// 按需載入交易分頁的數據
async function loadTransactionsData() {
    document.getElementById('loading-overlay').style.display = 'flex';
    try {
        const result = await apiRequest('get_transactions_with_staging', {}); // 【修改】改為呼叫新的 API
        if (result.success) {
            const { transactions, hasStagedChanges } = result.data;
            setState({
                transactions: transactions || [],
                hasStagedChanges: hasStagedChanges
            });
            renderTransactionsTable();
            updateStagingBanner();
        }
    } catch (error) {
        showNotification('error', `讀取交易紀錄失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

// 按需載入配息分頁的數據
export async function loadAndShowDividends() {
    document.getElementById('loading-overlay').style.display = 'flex';
    try {
        const result = await apiRequest('get_dividends_for_management', {});
        if (result.success) {
            setState({
                pendingDividends: result.data.pendingDividends,
                confirmedDividends: result.data.confirmedDividends,
            });
            renderDividendsManagementTab(result.data.pendingDividends, result.data.confirmedDividends);
        } else { throw new Error(result.message); }
    } catch (error) {
        showNotification('error', `讀取配息資料失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

// 初始化通用事件監聽器
function setupCommonEventListeners() {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => hideConfirm());
    document.getElementById('confirm-ok-btn').addEventListener('click', () => { 
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); } 
        hideConfirm(); 
    });
}

// 初始化主應用事件監聽器
function setupMainAppEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    // 【新增】為 "全部提交" 按鈕綁定事件
    document.getElementById('commit-all-btn').addEventListener('click', commitAllChanges);

    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            
            if (tabName === 'transactions' && getState().transactions.length === 0) {
                await loadTransactionsData();
            } else if (tabName === 'dividends' && !getState().pendingDividends) {
                await loadAndShowDividends();
            }
        }
    });

    document.getElementById('group-selector').addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        applyGroupView(selectedGroupId); // applyGroupView 內部已處理 'all' 的情況
    });
}

export function initializeAppUI() {
    if (getState().isAppInitialized) return;
    
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
    
    startSystemHealthCheck(); // 【新增】啟動健康檢查

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
