// =========================================================================================
// == API 通訊模組 (api.js) v5.3 (Refactor for UI Sync)
// =========================================================================================

import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { API } from './config.js';
import { getState, setState } from './state.js';
import { loadGroups } from './events/group.events.js'; // 【新增】導入 loadGroups

// --- UI Module Imports ---
import { getDateRangeForPreset } from './ui/utils.js';
import { updateAssetChart } from './ui/charts/assetChart.js';
import { updateTwrChart } from './ui/charts/twrChart.js';
import { updateNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderHoldingsTable } from './ui/components/holdings.ui.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js';
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { updateDashboard } from './ui/dashboard.js';
import { showNotification } from './ui/notifications.js';

/**
 * 統一的後端 API 請求函式
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
 * 【重構】提交暫存區的批次操作 - 現在只負責發送請求並回傳結果
 */
export async function submitBatch(actions) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = '正在提交所有變更並同步數據...';
    loadingOverlay.style.display = 'flex';

    try {
        const result = await apiRequest('submit_batch', { actions });
        if (result.success) {
            showNotification('success', '所有變更已成功提交並同步！');
            return result; // 直接回傳完整的成功結果
        } else {
            throw new Error(result.message || '批次提交時發生未知錯誤');
        }
    } catch (error) {
        showNotification('error', `提交失敗: ${error.message}`);
        throw error; // 向上拋出錯誤，讓呼叫者處理
    } finally {
        loadingOverlay.style.display = 'none';
        loadingTextElement.textContent = '正在從雲端同步資料...';
    }
}
// ========================= 【核心修改 - 結束】 =========================


/**
 * 高階 API 執行器 (主要用於非暫存區的單一操作)
 */
export async function executeApiAction(action, payload, { loadingText = '正在同步至雲端...', successMessage, shouldRefreshData = true }) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = loadingText;
    loadingOverlay.style.display = 'flex';
    
    try {
        const result = await apiRequest(action, payload);
        
        if (shouldRefreshData) {
            // 【修正】改為呼叫 get_data 獲取完整數據
            const fullData = await apiRequest('get_data', {});
            updateAppWithData(fullData.data);
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


// ========================= 【核心修改 - 開始】 =========================
/**
 * 【增強】統一的函式，用來接收計算結果並更新整個 App 的 UI
 * 現在可以處理包含群組在內的更完整的數據結構
 */
export function updateAppWithData(portfolioData, tempIdMap = {}) {
    if (!portfolioData) {
        console.error("updateAppWithData 收到無效數據，已跳過更新。");
        return;
    }
    
    // 1. 更新核心 State
    setState({
        transactions: portfolioData.transactions || [],
        userSplits: portfolioData.splits || [],
        // 【新增】更新群組列表
        groups: portfolioData.groups || [],
        portfolioHistory: portfolioData.history || {},
        twrHistory: portfolioData.twrHistory || {},
        benchmarkHistory: portfolioData.benchmarkHistory || {},
        netProfitHistory: portfolioData.netProfitHistory || {},
    });

    // 2. 處理持股數據
    const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});
    setState({ holdings: holdingsObject });

    // 3. 重設圖表日期範圍 (通常在全局更新後)
    if (Object.keys(portfolioData).length > 5) { // 簡單判斷是否為一次完整更新
        setState({
            assetDateRange: { type: 'all', start: null, end: null },
            twrDateRange: { type: 'all', start: null, end: null },
            netProfitDateRange: { type: 'all', start: null, end: null }
        });
    }

    // 4. 重新渲染所有相關的 UI 元件
    renderHoldingsTable(holdingsObject);
    renderTransactionsTable();
    renderSplitsTable();
    updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);
    
    // 【新增】重新載入並渲染群組相關 UI
    loadGroups(); 
    
    const { selectedGroupId } = getState();
    let seriesName = '投資組合'; 
    if (selectedGroupId && selectedGroupId !== 'all') {
        const selectedGroup = portfolioData.groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) seriesName = selectedGroup.name; 
    }
    
    updateAssetChart(seriesName); 
    updateNetProfitChart(seriesName);
    const benchmarkSymbol = portfolioData.summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol, seriesName);

    document.getElementById('benchmark-symbol-input').value = benchmarkSymbol;

    // 5. 更新圖表日期選擇器的顯示範圍
    const { portfolioHistory, twrHistory, netProfitHistory } = getState();
    const assetDates = getDateRangeForPreset(portfolioHistory, { type: 'all' });
    document.getElementById('asset-start-date').value = assetDates.startDate;
    document.getElementById('asset-end-date').value = assetDates.endDate;
    const twrDates = getDateRangeForPreset(twrHistory, { type: 'all' });
    document.getElementById('twr-start-date').value = twrDates.startDate;
    document.getElementById('twr-end-date').value = twrDates.endDate;
    const netProfitDates = getDateRangeForPreset(netProfitHistory, { type: 'all' });
    document.getElementById('net-profit-start-date').value = netProfitDates.startDate;
    document.getElementById('net-profit-end-date').value = netProfitDates.endDate;
}
// ========================= 【核心修改 - 結束】 =========================


/**
 * 從後端載入所有「全部股票」的投資組合資料並更新畫面
 */
export async function loadPortfolioData() {
    const { currentUserId } = getState();
    if (!currentUserId) {
        console.log("未登入，無法載入資料。");
        return;
    }
    document.getElementById('loading-overlay').style.display = 'flex';
    try {
        const result = await apiRequest('get_data', {});
        updateAppWithData(result.data);

    } catch (error) {
        console.error('Failed to load portfolio data:', error);
        showNotification('error', `讀取資料失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

/**
 * 請求後端按需計算特定群組的數據，並更新畫面
 */
export async function applyGroupView(groupId) {
    // 【修正】切換回 all 時，應使用更完整的 loadPortfolioData
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
            updateAppWithData(result.data);
            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        showNotification('error', `計算群組績效失敗: ${error.message}`);
        // 如果失敗，安全地切換回 'all' 視圖
        document.getElementById('group-selector').value = 'all';
        setState({ selectedGroupId: 'all' });
        await loadPortfolioData();
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}
