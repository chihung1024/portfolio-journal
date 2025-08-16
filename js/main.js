// =========================================================================================
// == 主程式進入點 (main.js) v4.0.1 - Import Fix
// =========================================================================================

import { getState, setState } from './state.js';
// 【修改】只引入 apiRequest 和 applyGroupView
import { apiRequest, applyGroupView } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';
import { initializeSettings, toggleColorScheme } from './settings.js'; // 【新增】引入設定模組

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
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { showNotification } from './ui/notifications.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

// --- 【新增】輕量級初始載入函式 ---
export async function loadInitialDashboardAndHoldings() {
    try {
        // 1. 呼叫新的輕量級 API
        const result = await apiRequest('get_dashboard_and_holdings', {});
        if (!result.success) throw new Error(result.message);

        // 2. 處理回傳的少量資料
        const { summary, holdings, stockNotes } = result.data;
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
        const stockNotesMap = (stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note; return map;
        }, {});

        // 3. 更新 State
        setState({
            holdings: holdingsObject,
            stockNotes: stockNotesMap,
            summary: summary // 將 summary 存入 state 供圖表使用
        });

        // 4. 渲染儀表板和持股列表 (這是使用者最先看到的內容)
        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        document.getElementById('benchmark-symbol-input').value = summary?.benchmarkSymbol || 'SPY';

    } catch (error) {
        showNotification('error', `讀取核心數據失敗: ${error.message}`);
    } finally {
        // 5. 隱藏讀取畫面，讓使用者可以開始互動
        document.getElementById('loading-overlay').style.display = 'none';
        
        // 6. 【關鍵】在背景延遲載入重量級的圖表數據
        setTimeout(loadChartDataInBackground, 500); // 延遲 500ms 確保主介面渲染流暢
    }
}

// --- 【新增】背景載入圖表數據 ---
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
            // 資料載入後，一次性更新所有圖表
            const { summary } = getState();
            updateAssetChart();
            updateTwrChart(summary?.benchmarkSymbol || 'SPY');
            updateNetProfitChart();
            console.log("圖表數據載入完成。");
        }
    } catch (error) {
        // 背景載入失敗不應該阻斷使用者操作，只在控制台顯示錯誤
        console.error('背景載入圖表數據失敗:', error);
        showNotification('error', '背景圖表數據載入失敗，部分圖表可能無法顯示。');
    }
}

// --- 【新增】交易/拆股記錄按需載入 ---
async function loadTransactionsData() {
    const { transactions } = getState();
    // 如果 state 中已經有交易紀錄，就直接渲染，避免重複請求
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

// --- 主流程函式 ---

export async function loadAndShowDividends() {
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

    // ================== 【新增/修改的程式碼開始】 ==================
    document.getElementById('color-scheme-toggle-btn').addEventListener('click', () => {
        toggleColorScheme();
        // 切換後立即重新渲染所有相關元件
        const { holdings, summary } = getState();
        updateDashboard(holdings, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdings);
    });
    // ================== 【新增/修改的程式碼結束】 ==================

    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            // 根據不同分頁按需載入內容
            if (tabName === 'dividends') {
                await loadAndShowDividends();
            } else if (tabName === 'transactions') {
                await loadTransactionsData(); // <-- 【修改】呼叫新的按需載入函式
            } else if (tabName === 'groups') {
                renderGroupsTab();
            } else if (tabName === 'splits') {
                renderSplitsTable();
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
            // 【重要修改】當切回"全部股票"時，應該重新觸發初始的輕量級載入流程
            document.getElementById('loading-overlay').style.display = 'flex';
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
    
    // UI 初始化只負責建立圖表物件和綁定事件，不載入任何數據
    initializeAssetChart();
    initializeTwrChart();
    initializeNetProfitChart();
    
    // ================== 【新增/修改的程式碼開始】 ==================
    initializeSettings(); // 初始化使用者設定
    // ================== 【新增/修改的程式碼結束】 ==================

    loadGroups(); // 載入群組列表，請求輕量
    
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
