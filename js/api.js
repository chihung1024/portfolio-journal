// =========================================================================================
// == API 通訊模組 (api.js) v5.0.0 - 支援操作隊列同步
// =========================================================================================

import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { API } from './config.js';
import { getState, setState } from './state.js';
import { clearQueue } from './op_queue_manager.js';

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
 * 【核心新增】執行同步操作，將操作隊列發送到後端
 */
export async function executeSync() {
    const { op_queue } = getState();
    if (op_queue.length === 0) {
        showNotification('info', '沒有需要同步的變更。');
        return;
    }

    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = `正在將 ${op_queue.length} 項變更同步至雲端...`;
    loadingOverlay.style.display = 'flex';
    
    try {
        // 呼叫新的後端 action: sync_operations
        const result = await apiRequest('sync_operations', { op_queue });
        
        if (result.success) {
            // 【關鍵步驟】使用後端返回的權威數據 (Source of Truth) 更新整個 App
            updateAppWithData(result.data);
            
            // 清空前端的操作隊列
            clearQueue();
            
            showNotification('success', '所有變更已成功同步！');
            return result;
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        showNotification('error', `同步失敗: ${error.message}。您的變更仍在暫存區，請稍後再試。`);
        throw error; 
    } finally {
        loadingOverlay.style.display = 'none';
        loadingTextElement.textContent = '正在從雲端同步資料...';
    }
}


/**
 * 統一的函式，用來接收後端權威數據並更新整個 App 的 UI
 * @param {object} portfolioData - 從後端 sync 或 get_data API 接收到的完整數據包
 */
export function updateAppWithData(portfolioData) {
    if (!portfolioData) {
        console.error("updateAppWithData 收到無效數據，已終止更新。");
        return;
    }

    const stockNotesMap = (portfolioData.stockNotes || []).reduce((map, note) => {
        map[note.symbol] = note;
        return map;
    }, {});

    const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});
    
    // 【核心】用後端返回的權威數據覆蓋前端 state
    setState({
        transactions: portfolioData.transactions || [],
        userSplits: portfolioData.splits || [],
        stockNotes: stockNotesMap,
        holdings: holdingsObject,
        portfolioHistory: portfolioData.history || {},
        twrHistory: portfolioData.twrHistory || {},
        benchmarkHistory: portfolioData.benchmarkHistory || {},
        netProfitHistory: portfolioData.netProfitHistory || {},
        // 同步後重設日期範圍
        assetDateRange: { type: 'all', start: null, end: null },
        twrDateRange: { type: 'all', start: null, end: null },
        netProfitDateRange: { type: 'all', start: null, end: null }
    });

    // --- 觸發所有相關的 UI 重新渲染 ---

    ['asset', 'twr', 'net-profit'].forEach(chartType => {
        const controls = document.getElementById(`${chartType}-chart-controls`);
        if (controls) {
            controls.querySelectorAll('.chart-range-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.range === 'all') btn.classList.add('active');
            });
        }
    });
    
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
 * 按需計算特定群組的數據，並更新畫面 (此函式邏輯不變，但依賴的 updateAppWithData 已更新)
 */
export async function applyGroupView(groupId) {
    if (!groupId || groupId === 'all') {
        // 如果切換回 "全部"，則從後端重新獲取完整的權威數據
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        loadingText.textContent = '正在載入全局數據...';
        loadingOverlay.style.display = 'flex';
        try {
            const result = await apiRequest('get_data', {});
            updateAppWithData(result.data);
        } catch(error) {
             showNotification('error', `讀取全局資料失敗: ${error.message}`);
        } finally {
            loadingOverlay.style.display = 'none';
        }
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
        document.getElementById('group-selector').value = 'all';
        await applyGroupView('all'); // 失敗時退回 "全部" 視圖
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}