// =========================================================================================
// == API 通訊模組 (api.js) v6.0 (Optimistic Update Refactor)
// =========================================================================================

import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { API } from './config.js';
import { getState, setState } from './state.js';
import { loadGroups } from './events/group.events.js'; 

// --- UI Module Imports ---
import { getDateRangeForPreset } from './ui/utils.js';
import { updateAssetChart } from './ui/charts/assetChart.js';
import { updateTwrChart } from './ui/charts/twrChart.js';
import { updateNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderHoldingsTable } from './ui/components/holdings.ui.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js';
import { renderClosedPositionsTable } from './ui/components/closedPositions.ui.js';
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { updateDashboard } from './ui/dashboard.js';
import { showNotification } from './ui/notifications.js';


/**
 * 統一的後端 API 請求函式 (底層)
 */
export async function apiRequest(action, data) {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
        showNotification('error', '請先登入再執行操作。');
        throw new Error('User not logged in');
    }

    try {
        const token = await user.getIdToken();
        const payload = { action, data };

        const response = await fetch(API.URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || '伺服器發生錯誤');
        }
        return result;

    } catch (error) {
        console.error('API 請求失敗:', error);
        throw error;
    }
}

// ========================= 【核心修改 - 開始】 =========================

/**
 * 【新】提交暫存區的批次操作 - 只負責發送請求並回傳結果，不等待完整計算。
 * @param {Array} actions - 要提交的淨操作陣列
 * @returns {Promise<object>} - 後端對請求的初步回應
 */
export async function submitBatchActions(actions) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = '正在提交變更...';
    loadingOverlay.style.display = 'flex';

    try {
        // 使用一個新的 API action 'submit_batch_async'，它會立即回傳，並在背景執行計算
        const result = await apiRequest('submit_batch_async', { actions });
        
        if (result.success) {
            showNotification('success', '變更已成功提交，系統正在背景為您更新數據。');
            return result; // result 可能包含 tempIdMap
        } else {
            throw new Error(result.message || '批次提交時發生未知錯誤');
        }
    } catch (error) {
        showNotification('error', `提交失敗: ${error.message}`);
        throw error;
    } finally {
        // 請求發出後很快就隱藏 loading
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
            loadingTextElement.textContent = '正在從雲端同步資料...';
        }, 500);
    }
}

/**
 * 【新】獲取全局最新數據並應用於整個 App
 * @param {boolean} showLoading - 是否顯示全局載入遮罩
 */
export async function fetchAndApplyGlobalData(showLoading = true) {
    const loadingOverlay = document.getElementById('loading-overlay');
    try {
        if (showLoading) {
            loadingOverlay.style.display = 'flex';
        }
        const result = await apiRequest('get_data', {});
        if (result.success) {
            await updateAppWithData(result.data);
            console.log("已從伺服器同步並應用最新權威數據。");
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("同步伺服器權威數據失敗:", error);
        showNotification('error', '無法從伺服器同步最新數據。');
    } finally {
        if (showLoading) {
            loadingOverlay.style.display = 'none';
        }
    }
}
// ========================= 【核心修改 - 結束】 =========================


/**
 * 高階 API 執行器 (主要用於非暫存區的單一操作，這些操作通常需要同步等待)
 */
export async function executeApiAction(action, payload, { loadingText = '正在同步至雲端...', successMessage, shouldRefreshData = true }) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = loadingText;
    loadingOverlay.style.display = 'flex';
    
    try {
        const result = await apiRequest(action, payload);
        
        if (shouldRefreshData) {
            // 在同步操作成功後，依然使用統一的 get_data 獲取完整數據來刷新
            const fullData = await apiRequest('get_data', {});
            await updateAppWithData(fullData.data);
        }
        
        if (successMessage) {
            showNotification('success', successMessage);
        }
        
        return result; 
    } catch (error) {
        showNotification('error', `操作失敗: ${error.message}`);
        throw error; 
    } finally {
        loadingOverlay.style.display = 'none';
        loadingTextElement.textContent = '正在從雲端同步資料...';
    }
}


/**
 * 統一的函式，用來接收計算結果並更新整個 App 的 UI (改為 async)
 */
export async function updateAppWithData(portfolioData, tempIdMap = {}) {
    if (!portfolioData) {
        console.error("updateAppWithData 收到無效數據，已跳過更新。");
        return;
    }
    
    const newState = {};
    if (portfolioData.transactions) newState.transactions = portfolioData.transactions;
    if (portfolioData.splits) newState.userSplits = portfolioData.splits;
    if (portfolioData.groups) newState.groups = portfolioData.groups;
    if (portfolioData.history) newState.portfolioHistory = portfolioData.history;
    if (portfolioData.twrHistory) newState.twrHistory = portfolioData.twrHistory;
    if (portfolioData.benchmarkHistory) newState.benchmarkHistory = portfolioData.benchmarkHistory;
    if (portfolioData.netProfitHistory) newState.netProfitHistory = portfolioData.netProfitHistory;
    if (portfolioData.closedPositions) {
        newState.closedPositions = portfolioData.closedPositions;
        newState.activeClosedPosition = null;
    }
    
    if (portfolioData.history) {
        newState.assetDateRange = { type: 'all', start: null, end: null };
        newState.twrDateRange = { type: 'all', start: null, end: null };
        newState.netProfitDateRange = { type: 'all', start: null, end: null };
    }
    
    const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});
    newState.holdings = holdingsObject;
    
    setState(newState);

    // 等待所有異步的 UI 渲染完成
    renderHoldingsTable(holdingsObject);
    if (portfolioData.transactions) await renderTransactionsTable();
    if (portfolioData.splits) await renderSplitsTable();
    if (portfolioData.groups) await loadGroups();
    if (portfolioData.closedPositions) renderClosedPositionsTable();
    
    updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);
    
    const { selectedGroupId, groups } = getState();
    let seriesName = '投資組合'; 
    if (selectedGroupId && selectedGroupId !== 'all') {
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) seriesName = selectedGroup.name; 
    }
    
    updateAssetChart(seriesName); 
    updateNetProfitChart(seriesName);
    const benchmarkSymbol = portfolioData.summary?.benchmarkSymbol || getState().summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol, seriesName);

    document.getElementById('benchmark-symbol-input').value = benchmarkSymbol;

    const { portfolioHistory, twrHistory, netProfitHistory } = getState();
    if(portfolioHistory && Object.keys(portfolioHistory).length > 0) {
        const assetDates = getDateRangeForPreset(portfolioHistory, { type: 'all' });
        document.getElementById('asset-start-date').value = assetDates.startDate;
        document.getElementById('asset-end-date').value = assetDates.endDate;
    }
    if(twrHistory && Object.keys(twrHistory).length > 0) {
        const twrDates = getDateRangeForPreset(twrHistory, { type: 'all' });
        document.getElementById('twr-start-date').value = twrDates.startDate;
        document.getElementById('twr-end-date').value = twrDates.endDate;
    }
    if(netProfitHistory && Object.keys(netProfitHistory).length > 0) {
        const netProfitDates = getDateRangeForPreset(netProfitHistory, { type: 'all' });
        document.getElementById('net-profit-start-date').value = netProfitDates.startDate;
        document.getElementById('net-profit-end-date').value = netProfitDates.endDate;
    }
}


/**
 * 從後端載入所有「全部股票」的投資組合資料並更新畫面
 */
export async function loadPortfolioData() {
    const { currentUserId } = getState();
    if (!currentUserId) {
        console.log("未登入，無法載入資料。");
        return;
    }
    
    // 使用新的統一函式
    await fetchAndApplyGlobalData(true);
}

/**
 * 請求後端按需計算特定群組的數據，並更新畫面
 */
export async function applyGroupView(groupId) {
    if (!groupId || groupId === 'all') {
        await loadPortfolioData();
        return;
    }

    const loadingText = document.getElementById('loading-text');
    document.getElementById('loading-overlay').style.display = 'flex';
    loadingText.textContent = '正在為您即時計算群組績效...';

    try {
        const result = await apiRequest('calculate_group_on_demand', { groupId });
        if (result.success) {
            await updateAppWithData(result.data);
            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        showNotification('error', `計算群組績效失敗: ${error.message}`);
        document.getElementById('group-selector').value = 'all';
        setState({ selectedGroupId: 'all' });
        await loadPortfolioData();
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}
