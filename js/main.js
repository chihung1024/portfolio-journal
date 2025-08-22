// =========================================================================================
// == 主程式進入點 (main.js) v5.1.0 - (修正) 統一暫存區狀態結構
// =========================================================================================

import { getState, setState } from './state.js';
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
import { updateStagingBanner } from './ui/components/stagingBanner.ui.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

let liveRefreshInterval = null;
let healthCheckInterval = null;

async function commitAllChanges() {
    const { hasStagedChanges, isCommitting } = getState();
    if (!hasStagedChanges || isCommitting) return;

    setState({ isCommitting: true });
    updateStagingBanner();

    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = '正在同步所有變更至雲端...';
    loadingOverlay.style.display = 'flex';

    try {
        const result = await apiRequest('commit_all_changes', {});
        if (result.success && result.data) {
            hydrateAppState(result.data);
            showNotification('success', '所有變更已成功同步！');
        } else {
            throw new Error(result.message || '提交失敗，但未收到明確錯誤訊息。');
        }
    } catch (error) {
        showNotification('error', `提交失敗: ${error.message}`);
        setState({ isCommitting: false });
        updateStagingBanner();
    } finally {
        loadingOverlay.style.display = 'none';
        loadingTextElement.textContent = '正在從雲端同步資料...';
    }
}

function startSystemHealthCheck() {
    stopSystemHealthCheck();
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
    healthCheckInterval = setInterval(checkHealth, 300000);
    checkHealth();
}

function stopSystemHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}

async function refreshDashboardAndHoldings() {
    try {
        const result = await apiRequest('get_dashboard_and_holdings', {});
        if (!result.success) return;
        const { summary, holdings } = result.data;
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
        setState({ holdings: holdingsObject, summary: summary });
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
        if (selectedGroupId !== 'all' || hasStagedChanges) return;
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

export async function loadInitialDashboard() {
    try {
        const result = await apiRequest('get_dashboard_summary', {});
        if (!result.success) throw new Error(result.message);
        const { summary, stockNotes } = result.data;
        const stockNotesMap = (stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note; return map;
        }, {});
        setState({ holdings: {}, stockNotes: stockNotesMap, summary: summary });
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
        apiRequest('get_transactions_with_staging', {}),
        apiRequest('get_dividends_for_management', {}),
        apiRequest('get_transactions_and_splits', {})
    ]);

    if (results[0].status === 'fulfilled' && results[0].value.success) {
        const { transactions, hasStagedChanges } = results[0].value.data;
        
        // ========================= 【核心修改 - 開始】 =========================
        // 為了解決狀態不一致問題，我們手動將載入的 transaction 轉換為標準的 change 物件格式
        const stagedChangesFromLoad = transactions
            .filter(t => t.status && t.status !== 'COMMITTED')
            .map(t => {
                let op;
                if (t.status === 'STAGED_CREATE') op = 'CREATE';
                else if (t.status === 'STAGED_UPDATE') op = 'UPDATE';
                else if (t.status === 'STAGED_DELETE') op = 'DELETE';
                
                const payload = (op === 'DELETE') ? { id: t.id } : { ...t };
                if (payload.status) {
                    delete payload.status;
                }

                return { id: t.id, op: op, entity: 'transaction', payload: payload };
            });
        // ========================= 【核心修改 - 結束】 =========================

        setState({
            transactions: transactions || [],
            hasStagedChanges: hasStagedChanges,
            stagedChanges: stagedChangesFromLoad // 使用結構一致的新陣列
        });
        
        renderTransactionsTable();
        updateStagingBanner();
    } else {
        console.error("預載交易紀錄失敗:", results[0].reason || results[0].value.message);
    }
    
    if (results[1].status === 'fulfilled' && results[1].value.success) {
        setState({
            pendingDividends: results[1].value.data.pendingDividends,
            confirmedDividends: results[1].value.data.confirmedDividends,
        });
        renderDividendsManagementTab(results[1].value.data.pendingDividends, results[1].value.data.confirmedDividends);
    } else {
        console.error("預載配息資料失敗:", results[1].reason || results[1].value.message);
    }
    
    if (results[2].status === 'fulfilled' && results[2].value.success) {
        setState({ userSplits: results[2].value.data.splits || [] });
        renderSplitsTable();
    } else {
        console.error("預載拆股資料失敗:", results[2].reason || results[2].value.message);
    }
}

async function loadTransactionsData() {
    document.getElementById('loading-overlay').style.display = 'flex';
    try {
        const result = await apiRequest('get_transactions_with_staging', {});
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

function setupMainAppEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('commit-all-btn').addEventListener('click', commitAllChanges);
    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
        }
    });
    document.getElementById('group-selector').addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        applyGroupView(selectedGroupId);
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
    startSystemHealthCheck();
    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
