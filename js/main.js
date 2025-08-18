// =========================================================================================
// == 主程式進入點 (main.js) v4.2.0 - Pre-fetching Optimization
// =========================================================================================

import { getState, setState } from './state.js';
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
import { hideConfirm, toggleOptionalFields } from './ui/modals.js';
import { showNotification } from './ui/notifications.js';
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
// 【新增】導入 getDateRangeForPreset 以計算圖表日期
import { getDateRangeForPreset } from './ui/utils.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

// 【新增】一個全域變數來存放我們的計時器
let liveRefreshInterval = null;

// 【新增】一個輕量級的刷新函式，只更新儀表板和持股
async function refreshDashboardAndHoldings() {
    try {
        // 呼叫現有的輕量級 API
        const result = await apiRequest('get_dashboard_and_holdings', {});
        if (!result.success) return;

        const { summary, holdings } = result.data;
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});

        // 只更新必要的 state
        setState({
            holdings: holdingsObject,
            summary: summary
        });

        // 只重新渲染儀表板和持股列表
        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        console.log("Live refresh complete.");

    } catch (error) {
        console.error("Live refresh failed:", error);
        // 在背景刷新失敗時，不需要打擾使用者
    }
}

// 【新增】啟動自動刷新的函式
export function startLiveRefresh() {
    stopLiveRefresh(); // 先停止舊的，以防萬一

    const poll = () => {
        // 【新增】檢查是否有任何彈出視窗是開啟的
        const isModalOpen = document.querySelector('#transaction-modal:not(.hidden)') ||
                            document.querySelector('#split-modal:not(.hidden)') ||
                            document.querySelector('#dividend-modal:not(.hidden)') ||
                            document.querySelector('#notes-modal:not(.hidden)') ||
                            document.querySelector('#details-modal:not(.hidden)') ||
                            document.querySelector('#group-modal:not(.hidden)');

        if (isModalOpen) {
            console.log("A modal is open, skipping live refresh to avoid interruption.");
            return; // 如果有視窗開啟，則直接跳過這次更新
        }

        // 簡單判斷是否為台股或美股開盤時間 (台灣時間)
        const now = new Date();
        const taipeiHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getHours();
        const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getDay();

        // 週一到週五
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            const isTwMarketOpen = taipeiHour >= 9 && taipeiHour < 14;
            const isUsMarketOpen = taipeiHour >= 21 || taipeiHour < 4;

            if (isTwMarketOpen || isUsMarketOpen) {
                 console.log("Market is open. Refreshing data...");
                 refreshDashboardAndHoldings();
            }
        }
    };
    
    // 每 60 秒執行一次
    liveRefreshInterval = setInterval(poll, 60000); 
    poll(); // 立即執行一次
}

// 【新增】停止自動刷新的函式
export function stopLiveRefresh() {
    if (liveRefreshInterval) {
        clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
        console.log("Live refresh stopped.");
    }
}


// --- 輕量級初始載入函式 ---
export async function loadInitialDashboardAndHoldings() {
    try {
        const result = await apiRequest('get_dashboard_and_holdings', {});
        if (!result.success) throw new Error(result.message);

        const { summary, holdings, stockNotes } = result.data;
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
        const stockNotesMap = (stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note; return map;
        }, {});

        setState({
            holdings: holdingsObject,
            stockNotes: stockNotesMap,
            summary: summary
        });

        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        document.getElementById('benchmark-symbol-input').value = summary?.benchmarkSymbol || 'SPY';

    } catch (error) {
        showNotification('error', `讀取核心數據失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        // 【修改】將背景載入的觸發點調整得更明確
        // 延遲 500ms 是為了確保主 UI 渲染完成，避免卡頓
        setTimeout(loadChartDataInBackground, 500);
    }
}

// --- 背景載入圖表數據 ---
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

            // --- 【核心修改】---
            // 在圖表數據載入並更新後，計算並填入起迄日期
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
            
            // 【新增】在圖表載入成功後，接續載入其他次要數據
            loadSecondaryDataInBackground();

        }
    } catch (error) {
        console.error('背景載入圖表數據失敗:', error);
        showNotification('error', '背景圖表數據載入失敗，部分圖表可能無法顯示。');
    }
}

// --- 【新增】第三階段背景載入：預載其他分頁的數據 ---
async function loadSecondaryDataInBackground() {
    console.log("正在背景預載次要數據 (交易紀錄、配息等)...");
    
    // 使用 Promise.allSettled 來確保兩個請求都會執行，即使其中一個失敗
    const results = await Promise.allSettled([
        apiRequest('get_transactions_and_splits', {}),
        apiRequest('get_dividends_for_management', {})
    ]);

    // 處理交易與拆股數據
    if (results[0].status === 'fulfilled' && results[0].value.success) {
        setState({
            transactions: results[0].value.data.transactions || [],
            userSplits: results[0].value.data.splits || [],
        });
        console.log("交易與拆股數據預載完成。");
    } else {
        console.error("預載交易紀錄失敗:", results[0].reason || results[0].value.message);
    }
    
    // 處理配息數據
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


// --- 【修改】交易/拆股記錄按需載入函式，現在主要作為後備方案 ---
async function loadTransactionsData() {
    // 檢查 state 中是否已有預載的數據
    const { transactions } = getState();
    if (transactions && transactions.length > 0) {
        renderTransactionsTable(); // 如果有，直接渲染
        return;
    }
    
    // 如果沒有預載數據（例如預載失敗），才顯示讀取畫面並重新請求
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

// --- 【修改】配息記錄按需載入函式，現在主要作為後備方案 ---
export async function loadAndShowDividends() {
    // 檢查 state 中是否已有預載的數據
    const { pendingDividends, confirmedDividends } = getState();
    if (pendingDividends && confirmedDividends) {
         renderDividendsManagementTab(pendingDividends, confirmedDividends); // 如果有，直接渲染
         return;
    }

    // 如果沒有預載數據，才顯示讀取畫面並重新請求
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
    document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirm);
    document.getElementById('confirm-ok-btn').addEventListener('click', () => { 
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); } 
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
            
            // 【修改】優化分頁切換邏輯
            const { transactions, pendingDividends, confirmedDividends, userSplits } = getState();

            if (tabName === 'dividends') {
                // 優先使用已預載的數據
                if (pendingDividends && confirmedDividends) {
                    renderDividendsManagementTab(pendingDividends, confirmedDividends);
                } else {
                    await loadAndShowDividends(); // 後備方案
                }
            } else if (tabName === 'transactions') {
                // 優先使用已預載的數據
                if (transactions.length > 0) {
                    renderTransactionsTable();
                } else {
                    await loadTransactionsData(); // 後備方案
                }
            } else if (tabName === 'groups') {
                renderGroupsTab();
            } else if (tabName === 'splits') {
                // 拆股數據與交易數據一起預載，所以也可以直接渲染
                if(userSplits) {
                    renderSplitsTable();
                }
                // 如果沒有拆股紀錄，renderSplitsTable 內部會處理顯示 "無資料" 的訊息
            }
        }
    });
    
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);

    const groupSelector = document.getElementById('group-selector');
    const recalcBtn = document.getElementById('recalculate-group-btn');

    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        if (selectedGroupId === 'all') {
            recalcBtn.classList.add('hidden');
            document.getElementById('loading-overlay').style.display = 'flex';
            // 【注意】切回 'all' 視圖時，我們只需要重新載入核心數據，
            // 不需要重新觸發背景預載，因為那些母數據 (transactions, etc.) 不會變
            loadInitialDashboardAndHoldings();
        } else {
            recalcBtn.classList.remove('hidden');
            showNotification('info', `已選擇群組。請點擊「計算群組績效」按鈕以檢視報表。`);
        }
    });

    recalcBtn.addEventListener('click', () => {
        const { selectedGroupId } = getState();
        if (selectedGroupId && selectedGroupId !== 'all') {
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
    lucide.createIcons();

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
