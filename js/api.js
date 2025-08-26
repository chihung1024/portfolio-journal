// =========================================================================================
// == API 通訊模組 (api.js) v5.1 - Bug Fix (ID 同步)
// =========================================================================================

import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { API } from './config.js';
import { getState, setState } from './state.js';

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

/**
 * 提交暫存區的批次操作
 */
export async function submitBatch(actions) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = '正在提交所有變更並同步數據...';
    loadingOverlay.style.display = 'flex';

    try {
        const result = await apiRequest('submit_batch', { actions });
        if (result.success) {
            // 【核心修正】將後端回傳的 tempIdMap 傳入更新函式
            updateAppWithData(result.data, result.data.tempIdMap);
            showNotification('success', '所有變更已成功提交並同步！');
            return result.data;
        } else {
            throw new Error(result.message || '批次提交時發生未知錯誤');
        }
    } catch (error) {
        showNotification('error', `提交失敗: ${error.message}`);
        throw error;
    } finally {
        loadingOverlay.style.display = 'none';
        loadingTextElement.textContent = '正在從雲端同步資料...';
    }
}

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

/**
 * 【核心修正】統一的函式，用來接收計算結果並更新整個 App 的 UI (增加 tempIdMap 處理)
 */
function updateAppWithData(portfolioData, tempIdMap = {}) {
    if (!portfolioData) {
        console.error("updateAppWithData 收到無效數據，已跳過更新。");
        return;
    }

    // 【核心修正】在更新 state 之前，先處理 ID 映射
    if (Object.keys(tempIdMap).length > 0) {
        const { transactions, userSplits } = getState(); // 可擴充到其他實體
        const updateEntities = (entities) => {
            return entities.map(entity => {
                if (tempIdMap[entity.id]) {
                    return { ...entity, id: tempIdMap[entity.id] };
                }
                return entity;
            });
        };
        setState({
            transactions: updateEntities(transactions),
            userSplits: updateEntities(userSplits)
            // ... 其他需要更新 ID 的 state
        });
    }
    
    // 現在使用後端回傳的、帶有永久 ID 的數據來更新 state
    setState({
        transactions: portfolioData.transactions || [],
        userSplits: portfolioData.splits || [],
    });

    const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});
    
    setState({
        holdings: holdingsObject,
        portfolioHistory: portfolioData.history || {},
        twrHistory: portfolioData.twrHistory || {},
        benchmarkHistory: portfolioData.benchmarkHistory || {},
        netProfitHistory: portfolioData.netProfitHistory || {},
        assetDateRange: { type: 'all', start: null, end: null },
        twrDateRange: { type: 'all', start: null, end: null },
        netProfitDateRange: { type: 'all', start: null, end: null }
    });

    // 後續的 UI 渲染邏輯不變...
    renderHoldingsTable(holdingsObject);
    renderTransactionsTable();
    renderSplitsTable();
    updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);
    
    const { selectedGroupId, groups } = getState();
    let seriesName = '投資組合'; 
    if (selectedGroupId && selectedGroupId !== 'all') {
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) seriesName = selectedGroup.name; 
    }
    
    updateAssetChart(seriesName); 
    updateNetProfitChart(seriesName);
    const benchmarkSymbol = portfolioData.summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol, seriesName);

    document.getElementById('benchmark-symbol-input').value = benchmarkSymbol;

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

/**
 * 從後端載入所有「全部股票」的投資組合資料並更新畫面
 */
export async function loadPortfolioData() {
    // ... 此函式內容不變 ...
}

/**
 * 請求後端按需計算特定群組的數據，並更新畫面
 */
export async function applyGroupView(groupId) {
    // ... 此函式內容不變 ...
}
