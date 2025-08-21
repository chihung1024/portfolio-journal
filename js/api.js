// =========================================================================================
// == API 通訊模組 (api.js) v6.0.0 - ATLAS-COMMIT Architecture
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
// renderDividendsManagementTab might need adjustments later
// import { renderDividendsManagementTab } from "./ui/components/dividends.ui.js";

/**
 * 核心：統一的後端 API 請求函式 (維持不變)
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

        // 擴展錯誤處理以應對 202 Accepted
        if (!response.ok && response.status !== 202) {
            if (response.status === 401 || response.status === 403) {
                 throw new Error(result.message || '認證失敗，您的登入可能已過期，請嘗試重新整理頁面。');
            }
            throw new Error(result.message || '伺服器發生錯誤');
        }
        
        // 將狀態碼附加到結果中，以便前端可以判斷
        result.status = response.status;
        return result;

    } catch (error) {
        console.error('API 請求失敗:', error);
        throw error;
    }
}

/**
 * 高階 API 執行器，封裝了載入狀態 (維持不變，主要用於 commitAllChanges)
 */
export async function executeApiAction(action, payload, { loadingText = '正在同步至雲端...', successMessage, onSuccess }) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = loadingText;
    loadingOverlay.style.display = 'flex';
    
    try {
        const result = await apiRequest(action, payload);
        
        if (onSuccess) {
            onSuccess(result.data); // 將回傳的數據傳遞給成功回調
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
 * [更名並強化] 核心：原子性地使用後端回傳的完整數據來刷新整個前端 App 狀態
 * @param {object} fullData - 後端 API 回傳的完整 portfolio 數據物件
 */
export function hydrateAppState(fullData) {
    if (!fullData) return;

    // --- 將交易與相關數據的狀態更新置於最前 ---
    const transactions = fullData.transactions || [];
    setState({
        transactions: transactions,
        userSplits: fullData.splits || [],
        // [新增] 更新 hasStagedChanges 旗標
        hasStagedChanges: fullData.hasStagedChanges || transactions.some(t => t.status !== 'COMMITTED'),
    });

    const stockNotesMap = (fullData.stockNotes || []).reduce((map, note) => {
        map[note.symbol] = note; return map;
    }, {});

    const holdingsObject = (fullData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});
    
    setState({
        stockNotes: stockNotesMap,
        holdings: holdingsObject,
        portfolioHistory: fullData.history || {},
        twrHistory: fullData.twrHistory || {},
        benchmarkHistory: fullData.benchmarkHistory || {},
        netProfitHistory: fullData.netProfitHistory || {},
        assetDateRange: { type: 'all', start: null, end: null },
        twrDateRange: { type: 'all', start: null, end: null },
        netProfitDateRange: { type: 'all', start: null, end: null }
    });

    // --- 觸發所有相關的 UI 重新渲染 ---

    // 重設圖表日期範圍按鈕
    ['asset', 'twr', 'net-profit'].forEach(chartType => {
        const controls = document.getElementById(`${chartType}-chart-controls`);
        if (controls) {
            controls.querySelectorAll('.chart-range-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.range === 'all') btn.classList.add('active');
            });
        }
    });
    
    // 渲染核心表格和儀表板
    renderHoldingsTable(holdingsObject);
    renderTransactionsTable(); // 現在此函式會使用上面剛更新的、帶有 status 的 transaction 狀態
    renderSplitsTable();
    updateDashboard(holdingsObject, fullData.summary?.totalRealizedPL, fullData.summary?.overallReturnRate, fullData.summary?.xirr);
    
    // 更新圖表
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

    // 更新圖表日期選擇器的預設值
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
 * [維持不變] 從後端載入初始的、所有「已確認」的投資組合資料
 */
export async function loadPortfolioData() {
    const { currentUserId } = getState();
    if (!currentUserId) return;
    
    document.getElementById('loading-overlay').style.display = 'flex';
    try {
        // 初始載入時，仍然呼叫 get_data 來獲取一個完整的、乾淨的狀態快照
        const result = await apiRequest('get_data', {});
        hydrateAppState(result.data);
    } catch (error) {
        showNotification('error', `讀取資料失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}


/**
 * [維持不變] 按需計算特定群組的數據
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
            hydrateAppState(result.data); // 使用統一的注水函式
            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        showNotification('error', `計算群組績效失敗: ${error.message}`);
        document.getElementById('group-selector').value = 'all';
        await loadPortfolioData();
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}


// ========================================================================
// == [新增] ATLAS-COMMIT v1.4 新增的 API 函式
// ========================================================================

/**
 * [新增] 1. 將單筆變更提交到後端暫存區
 * @param {object} changeObject - e.g., { op: 'CREATE', entity: 'transaction', payload: {...} }
 */
export async function stageChange(changeObject) {
    try {
        await apiRequest('stage_change', changeObject);
        // 此處不處理成功訊息，交給呼叫它的事件處理器來刷新視圖
    } catch (error) {
        showNotification('error', `暫存操作失敗: ${error.message}`);
        throw error; // 向上拋出錯誤，以便樂觀更新可以回滾
    }
}

/**
 * [新增] 2. 獲取融合了暫存區數據的交易列表
 */
export async function getTransactionsWithStaging() {
    try {
        const result = await apiRequest('get_transactions_with_staging', {});
        if (result.success) {
            return result.data;
        }
        throw new Error(result.message);
    } catch (error) {
        showNotification('error', `讀取待辦事項失敗: ${error.message}`);
        return null;
    }
}

/**
 * [新增] 3. 提交所有暫存變更以進行最終計算
 */
export async function commitAllChanges() {
    // 使用高階執行器來處理全局載入畫面和成功回調
    await executeApiAction('commit_all_changes', {}, {
        loadingText: '正在提交所有變更並執行最終計算...',
        successMessage: '所有變更已成功提交！您的投資組合正在更新...',
        onSuccess: (data) => {
            // 當後端同步計算完成後，使用回傳的最新數據來原子性地刷新整個 App
            hydrateAppState(data);
        }
    });
}

/**
 * [新增] 4. 捨棄單筆暫存變更
 * @param {string} changeId - 要捨棄的 staged_changes 紀錄的 ID
 */
export async function revertStagedChange(changeId) {
     try {
        await apiRequest('revert_staged_change', { changeId });
        showNotification('success', '該項待辦變更已捨棄。');
    } catch (error) {
        showNotification('error', `捨棄操作失敗: ${error.message}`);
        throw error;
    }
}

/**
 * [新增] 5. 獲取系統健康狀態 (用於檢查快照)
 */
export async function getSystemHealth() {
    try {
        const result = await apiRequest('get_system_health', {});
        return result.data;
    } catch (error) {
        // 健康檢查失敗不應打擾使用者，僅在控制台記錄
        console.error("獲取系統健康狀態失敗:", error);
        return null;
    }
}
