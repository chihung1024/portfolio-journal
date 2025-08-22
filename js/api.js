// =========================================================================================
// == API 通訊模組 (api.js) v5.0.0 - 支援 ATLAS-COMMIT 架構
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
import { renderDividendsManagementTab } from "./ui/components/dividends.ui.js";
// 【新增】引入 stagingBanner 的更新函式
import { updateStagingBanner } from "./ui/components/stagingBanner.ui.js";


/**
 * 統一的後端 API 請求函式 (維持不變)
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
            if (response.status === 401 || response.status === 403) {
                 throw new Error(result.message || '認證失敗，您的登入可能已過期，請嘗試重新整理頁面。');
            }
            throw new Error(result.message || '伺服器發生錯誤');
        }
        return result;

    } catch (error) {
        console.error('API 請求失敗:', error);
        throw error;
    }
}


/**
 * 【新增】核心函式，用來接收計算結果並原子性地更新整個 App 的 UI
 * @param {object} fullData - 從後端 commit_all_changes API 回傳的完整數據
 */
export function hydrateAppState(fullData) {
    console.log("Hydrating app with new authoritative state...");

    // 步驟一：重設暫存區狀態
    setState({
        hasStagedChanges: false,
        stagedChanges: [],
        isCommitting: false,
    });
    updateStagingBanner(); // 更新橫幅 UI

    // 步驟二：更新核心數據狀態
    const stockNotesMap = (fullData.stockNotes || []).reduce((map, note) => {
        map[note.symbol] = note; return map;
    }, {});

    const holdingsObject = (fullData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});
    
    setState({
        transactions: fullData.transactions || [],
        userSplits: fullData.splits || [],
        stockNotes: stockNotesMap,
        holdings: holdingsObject,
        portfolioHistory: fullData.history || {},
        twrHistory: fullData.twrHistory || {},
        benchmarkHistory: fullData.benchmarkHistory || {},
        netProfitHistory: fullData.netProfitHistory || {},
        // 重設圖表日期範圍
        assetDateRange: { type: 'all', start: null, end: null },
        twrDateRange: { type: 'all', start: null, end: null },
        netProfitDateRange: { type: 'all', start: null, end: null }
    });

    // 步驟三：原子性地重繪所有相關 UI 元件
    
    // 1. 重繪儀表板
    updateDashboard(holdingsObject, fullData.summary?.totalRealizedPL, fullData.summary?.overallReturnRate, fullData.summary?.xirr);

    // 2. 重繪主要列表
    renderHoldingsTable(holdingsObject);
    renderTransactionsTable(); 
    renderSplitsTable();
    
    // 3. 重繪所有圖表
    const { selectedGroupId, groups } = getState();
    let seriesName = '投資組合'; 
    if (selectedGroupId && selectedGroupId !== 'all') {
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) seriesName = selectedGroup.name; 
    }
    
    updateAssetChart(seriesName); 
    updateNetProfitChart(seriesName);
    const benchmarkSymbol = fullData.summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol, seriesName);
    document.getElementById('benchmark-symbol-input').value = benchmarkSymbol;

    // 4. 更新圖表日期選擇器的顯示範圍
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

    // 5. 重設圖表日期範圍按鈕為 "全部"
    ['asset', 'twr', 'net-profit'].forEach(chartType => {
        const controls = document.getElementById(`${chartType}-chart-controls`);
        if (controls) {
            controls.querySelectorAll('.chart-range-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.range === 'all') btn.classList.add('active');
            });
        }
    });

    console.log("App hydration complete.");
}


/**
 * 【重構】高階 API 執行器，現在主要用於非暫存區的、需要全局刷新的操作 (如更新 Benchmark)
 */
export async function executeApiAction(action, payload, { loadingText = '正在同步至雲端...', successMessage, shouldRefreshData = true }) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = loadingText;
    loadingOverlay.style.display = 'flex';
    
    try {
        const result = await apiRequest(action, payload);
        
        if (shouldRefreshData && result.data) {
            hydrateAppState(result.data);
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
 * 按需計算特定群組的數據，並更新畫面 (此函式邏輯不變，但其內部會呼叫 hydrateAppState)
 */
export async function applyGroupView(groupId) {
    if (!groupId || groupId === 'all') {
        // 切換回 'all' 時，執行完整的初始載入流程
        const { initializeAppUI, loadInitialDashboard, startLiveRefresh } = await import('./main.js');
        initializeAppUI();
        loadInitialDashboard();
        startLiveRefresh();
        return;
    }

    const loadingText = document.getElementById('loading-text');
    document.getElementById('loading-overlay').style.display = 'flex';
    loadingText.textContent = '正在為您即時計算群組績效...';

    try {
        const result = await apiRequest('calculate_group_on_demand', { groupId });
        if (result.success) {
            // 使用 hydrateAppState 來刷新整個 UI，確保一致性
            hydrateAppState(result.data);
            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        showNotification('error', `計算群組績效失敗: ${error.message}`);
        document.getElementById('group-selector').value = 'all';
        // 如果失敗，則重新載入 'all' 的數據
        const { loadInitialDashboard } = await import('./main.js');
        loadInitialDashboard();

    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}
