// =========================================================================================
// == 主程式進入點 (main.js) v4.3.0 - 條件式輪詢
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
import { getDateRangeForPreset, findFxRateForFrontend } from './ui/utils.js'; // 確保 findFxRateForFrontend 已導入

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

// =========================================================================================
// == 即時報價輪詢模組 (Live Quote Polling Module)
// =========================================================================================

let liveQuoteInterval = null;
// 【請修改此處】換成您 NAS/本地伺服器的公開網址或區域網路 IP 位址
const QUOTE_SERVER_URL = 'https://finnhub-api.911330.xyz'; 

/**
 * 檢查當前時間是否為台股或美股的開盤交易時段
 * @returns {{isOpen: boolean, market: string}} - 回傳一個物件，包含是否開盤及哪個市場
 */
function isMarketOpen() {
    const now = new Date();

    // --- 檢查台灣市場 (Asia/Taipei) ---
    const taipeiTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const taipeiDay = taipeiTime.getDay(); // 0=週日, 1=週一, ..., 6=週六
    const taipeiHour = taipeiTime.getHours();
    const taipeiMinutes = taipeiTime.getMinutes();
    
    // 台股交易日: 週一 (1) 到 週五 (5)
    const isTwWeekday = taipeiDay >= 1 && taipeiDay <= 5;
    // 台股交易時間: 09:00 - 13:30
    const isTwTradingHours = (taipeiHour >= 9 && taipeiHour < 13) || (taipeiHour === 13 && taipeiMinutes <= 30);

    if (isTwWeekday && isTwTradingHours) {
        return { isOpen: true, market: 'TSE' };
    }

    // --- 檢查美國市場 (America/New_York) ---
    // 使用 toLocaleString 可以自動處理夏令時 (DST)
    const newYorkTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const newYorkDay = newYorkTime.getDay();
    const newYorkHour = newYorkTime.getHours();
    const newYorkMinutes = newYorkTime.getMinutes();

    // 美股交易日: 週一 (1) 到 週五 (5)
    const isUsWeekday = newYorkDay >= 1 && newYorkDay <= 5;
    // 美股交易時間: 09:30 - 16:00
    const isUsTradingHours = (newYorkHour > 9 || (newYorkHour === 9 && newYorkMinutes >= 30)) && (newYorkHour < 16);

    if (isUsWeekday && isUsTradingHours) {
        return { isOpen: true, market: 'NYSE/NASDAQ' };
    }

    // --- 若都未開盤 ---
    return { isOpen: false, market: 'Closed' };
}

/**
 * 使用從本地報價伺服器獲取的即時數據來更新 UI
 * @param {object} liveQuotes - 格式為 { "SYMBOL": 123.45, ... } 的物件
 */
function updateUIWithLiveData(liveQuotes) {
    if (!liveQuotes || Object.keys(liveQuotes).length === 0) return;

    const { holdings, summary } = getState();
    const holdingsArray = Object.values(holdings);
    
    // 遍歷當前持股，用 liveQuotes 的新價格來更新計算
    holdingsArray.forEach(h => {
        const livePrice = liveQuotes[h.symbol];
        
        // 如果 API 成功回傳價格，則使用它；否則，沿用舊價格
        const currentPrice = livePrice ?? h.currentPriceOriginal;
        
        // 重新計算關鍵指標
        const fxRate = findFxRateForFrontend(h.currency, new Date().toISOString().split('T')[0]);
        // 根據前一次的當日損益，反推出昨日收盤價，作為計算今日變化的基礎
        const yesterdayPrice = h.currentPriceOriginal - (h.daily_pl_twd / (h.quantity * fxRate));

        h.currentPriceOriginal = currentPrice;
        h.marketValueTWD = h.quantity * currentPrice * fxRate;
        h.unrealizedPLTWD = h.marketValueTWD - h.totalCostTWD;
        h.returnRate = h.totalCostTWD > 0 ? (h.unrealizedPLTWD / h.totalCostTWD) * 100 : 0;
        h.daily_pl_twd = (currentPrice - yesterdayPrice) * h.quantity * fxRate;
        h.daily_change_percent = yesterdayPrice > 0 ? ((currentPrice - yesterdayPrice) / yesterdayPrice) * 100 : 0;
    });

    const newHoldingsObject = holdingsArray.reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});
    
    // 使用更新後的數據重新渲染儀表板和持股表格
    updateDashboard(newHoldingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
    renderHoldingsTable(newHoldingsObject);
}

/**
 * 啟動即時報價輪詢
 */
export function startLiveRefresh() {
    stopLiveRefresh(); // 先確保停止舊的計時器

    const poll = async () => {
        const { holdings, selectedGroupId } = getState();
        const symbols = Object.keys(holdings);

        // 使用新的智慧判斷函式
        const marketStatus = isMarketOpen();

        // 檢查是否開盤、是否有持股、以及是否在 '全部股票' 視圖
        if (!marketStatus.isOpen || symbols.length === 0 || selectedGroupId !== 'all') {
            console.log("市場休市中或不符合條件，跳過即時報價。");
            return;
        }

        // 只有在市場開盤時，才執行後續的報價請求
        try {
            console.log(`偵測到 ${marketStatus.market} 開盤，向本地伺服器請求 ${symbols.length} 筆即時報價...`);
            const response = await fetch(`${QUOTE_SERVER_URL}/api/live-quotes?symbols=${symbols.join(',')}`);
            if (!response.ok) {
                throw new Error(`報價伺服器錯誤: ${response.statusText}`);
            }
            const liveQuotes = await response.json();
            
            // 呼叫專門的函式來更新畫面
            updateUIWithLiveData(liveQuotes);

        } catch (e) {
            console.error("輪詢即時報價失敗:", e);
        }
    };
    
    liveQuoteInterval = setInterval(poll, 15000); // 30 秒更新一次
    poll(); // 啟動後立即執行一次
}


/**
 * 停止即時報價輪詢
 */
export function stopLiveRefresh() {
    if (liveQuoteInterval) {
        clearInterval(liveQuoteInterval);
        liveQuoteInterval = null;
        console.log("已停止即時報價輪詢。");
    }
}

// =========================================================================================
// == 應用程式核心載入邏輯 (App Core Loading Logic)
// =========================================================================================

export async function loadInitialDashboardAndHoldings() {
    try {
        const result = await apiRequest('get_dashboard_and_holdings', {});
        if (!result.success) throw new Error(result.message);

        const { summary, holdings, stockNotes } = result.data;
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
        const stockNotesMap = (stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note;
            return map;
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
        setTimeout(loadChartDataInBackground, 500);
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
            
            const { transactions, pendingDividends, confirmedDividends, userSplits } = getState();

            if (tabName === 'dividends') {
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
    
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);

    const groupSelector = document.getElementById('group-selector');
    const recalcBtn = document.getElementById('recalculate-group-btn');

    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        if (selectedGroupId === 'all') {
            recalcBtn.classList.add('hidden');
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
