// =========================================================================================
// == API 通訊模組 (api.js) v6.0 - Refactored
// == 職責：提供統一的後端 API 請求介面，作為純粹的資料層。
// =========================================================================================

import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { API } from './config.js';
import { getState, setState } from './state.js';
import { showNotification } from './ui/notifications.js';
import { updateStagingBanner } from "./ui/components/stagingBanner.ui.js";
import { renderTransactionsTable } from "./ui/components/transactions.ui.js";

// ========================= 【核心修改 - 開始】 =========================
// 導入 app.js 中的 UI 更新函式
import { updateAppWithData } from './app.js';
// ========================= 【核心修改 - 結束】 =========================


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
 * 高階 API 執行器，專注於顯示全局讀取畫面，不再負責資料刷新
 */
export async function executeApiAction(action, payload, { loadingText = '正在同步至雲端...', successMessage }) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = loadingText;
    loadingOverlay.style.display = 'flex';
    
    try {
        const result = await apiRequest(action, payload);
        
        // ========================= 【核心修改 - 開始】 =========================
        // 移除 shouldRefreshData 和對 main.js 的動態導入
        // 資料刷新邏輯已移至呼叫端 (caller) 處理
        // ========================= 【核心修改 - 結束】 =========================
        
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
 * 從後端載入包含暫存狀態的初始交易資料
 */
export async function loadInitialData() {
    const { currentUserId } = getState();
    if (!currentUserId) return;

    document.getElementById('loading-overlay').style.display = 'flex';
    try {
        const result = await apiRequest('get_transactions_with_staging', {});
        
        if (result.success) {
            setState({
                transactions: result.data.transactions || [],
                hasStagedChanges: result.data.hasStagedChanges
            });

            renderTransactionsTable();
            updateStagingBanner();
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error('Failed to load initial data:', error);
        showNotification('error', `讀取初始資料失敗: ${error.message}`);
    } finally {
        // 注意：此處不再隱藏 loading-overlay，由主流程控制
    }
}

/**
 * 請求後端按需計算特定群組的數據，並使用 app.js 中的函式更新 UI
 */
export async function applyGroupView(groupId) {
    const loadingText = document.getElementById('loading-text');
    document.getElementById('loading-overlay').style.display = 'flex';
    loadingText.textContent = '正在為您即時計算群組績效...';

    try {
        const result = await apiRequest('calculate_group_on_demand', { groupId });
        if (result.success) {
            const { groups } = getState();
            const selectedGroup = groups.find(g => g.id === groupId);
            const seriesName = selectedGroup ? selectedGroup.name : '群組';

            // ========================= 【核心修改 - 開始】 =========================
            // 使用從 app.js 導入的函式來更新整個 App 的 UI
            updateAppWithData({ ...result.data, transactions: getState().transactions }, seriesName);
            // ========================= 【核心修改 - 結束】 =========================
            
            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        showNotification('error', `計算群組績效失敗: ${error.message}`);
        // 失敗時，將下拉選單重設回「全部股票」，但不主動刷新，給予使用者控制權
        document.getElementById('group-selector').value = 'all';
        setState({ selectedGroupId: 'all' });
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}

/**
 * 更新用戶選擇的 benchmark
 */
export async function updateBenchmark(symbol) {
    const loadingText = document.getElementById('loading-text');
    document.getElementById('loading-overlay').style.display = 'flex';
    loadingText.textContent = `正在更新比較基準為 ${symbol}...`;

    try {
        const { selectedGroupId } = getState();
        const result = await apiRequest('update_benchmark', { symbol, groupId: selectedGroupId });
        if (result.success) {
            setState({
                benchmarkHistory: result.data.benchmarkHistory
            });
            const { summary } = getState();
            const newSummary = { ...summary, benchmarkSymbol: symbol };
            setState({ summary: newSummary });

            const { twrHistory, selectedGroupId, groups } = getState();
            let seriesName = '投資組合';
            if (selectedGroupId && selectedGroupId !== 'all') {
                const selectedGroup = groups.find(g => g.id === selectedGroupId);
                if (selectedGroup) seriesName = selectedGroup.name;
            }
            const { updateTwrChart } = await import('./ui/charts/twrChart.js');
            updateTwrChart(symbol, seriesName);
            showNotification('success', `比較基準已更新為 ${symbol}`)
        }
    } catch (error) {
        showNotification('error', `更新比較基準失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}