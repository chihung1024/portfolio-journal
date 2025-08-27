// =========================================================================================
// == API 通訊模組 (api.js) v6.0 (Atomic & Client-Driven)
// == 職責：提供與後端原子化 API 對應的請求函式，並主導客戶端的數據獲取流程。
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
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { updateDashboard } from './ui/dashboard.js';
import { showNotification } from './ui/notifications.js';

/**
 * 統一的後端 API 請求基礎函式 (Low-level)
 */
export async function apiRequest(action, data) {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
        const errorMessage = 'User not logged in';
        showNotification('error', '請先登入再執行操作。');
        console.error('API 請求失敗:', errorMessage, 'Action:', action);
        throw new Error(errorMessage);
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
            throw new Error(result.message || `伺服器錯誤 (狀態碼: ${response.status})`);
        }
        return result;

    } catch (error) {
        console.error('API 請求失敗:', 'Action:', action, 'Data:', data, 'Error:', error);
        throw error;
    }
}

/**
 * 【重構】提交暫存區的批次操作 - 只負責發送請求並回傳最小化結果
 */
export async function submitBatch(actions) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = '正在提交所有變更並同步數據...';
    loadingOverlay.style.display = 'flex';

    try {
        // 後端 submit_batch 現在只回傳 { success, message, data: { tempIdMap } }
        const result = await apiRequest('submit_batch', { actions });
        if (result.success) {
            showNotification('success', '所有變更已成功提交！');
            return result; // 將包含 tempIdMap 的結果回傳
        } else {
            throw new Error(result.message || '批次提交時發生未知錯誤');
        }
    } catch (error) {
        showNotification('error', `提交失敗: ${error.message}`);
        throw error;
    } finally {
        // 注意：這裡不再隱藏 loading，因為後續還需要刷新數據
        loadingTextElement.textContent = '正在從雲端同步資料...';
    }
}


// ========================= 【核心修改 - 開始】 =========================

/**
 * 【廢除】移除 updateAppWithData 函式。
 * 其職責將被分解到 main.js 和 api.js 中更具體的函式裡。
 */

/**
 * 【廢除】移除 executeApiAction 和 loadPortfolioData 函式。
 * 前端現在採用更細粒度的、由客戶端主導的數據獲取模式。
 */

/**
 * 【新增】獲取並更新所有核心數據（摘要、持股、圖表）
 * 供初始加載和全局刷新使用
 */
export async function fetchAllCoreData(showLoading = true) {
    if(showLoading) {
        document.getElementById('loading-overlay').style.display = 'flex';
    }
    try {
        // 並行請求多個原子化 API
        const [summaryRes, holdingsRes, chartsRes] = await Promise.all([
            apiRequest('get_dashboard_summary', {}),
            apiRequest('get_holdings', {}),
            apiRequest('get_chart_data', {})
        ]);

        if (!summaryRes.success || !holdingsRes.success || !chartsRes.success) {
            throw new Error('一個或多個核心數據請求失敗');
        }

        const { summary, stockNotes } = summaryRes.data;
        const { holdings } = holdingsRes.data;
        const { portfolioHistory, twrHistory, benchmarkHistory, netProfitHistory } = chartsRes.data;

        // 更新 State
        const holdingsObject = (holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
         const stockNotesMap = (stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note; return map;
        }, {});

        setState({
            summary,
            stockNotes: stockNotesMap,
            holdings: holdingsObject,
            portfolioHistory,
            twrHistory,
            benchmarkHistory,
            netProfitHistory,
            assetDateRange: { type: 'all', start: null, end: null },
            twrDateRange: { type: 'all', start: null, end: null },
            netProfitDateRange: { type: 'all', start: null, end: null }
        });

        // 更新 UI
        updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
        renderHoldingsTable(holdingsObject);
        document.getElementById('benchmark-symbol-input').value = summary?.benchmarkSymbol || 'SPY';

        updateAssetChart();
        updateTwrChart(summary?.benchmarkSymbol || 'SPY');
        updateNetProfitChart();

        // 更新圖表日期選擇器
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

    } catch (error) {
        console.error('Failed to load all core data:', error);
        showNotification('error', `讀取核心資料失敗: ${error.message}`);
    } finally {
        if(showLoading) {
            document.getElementById('loading-overlay').style.display = 'none';
        }
    }
}

/**
 * 【新增】請求後端按需計算特定群組的數據，並更新畫面
 */
export async function applyGroupView(groupId) {
    if (!groupId || groupId === 'all') {
        await fetchAllCoreData(); // 如果是全局視圖，則刷新所有核心數據
        await loadGroups();
        return;
    }

    const loadingText = document.getElementById('loading-text');
    document.getElementById('loading-overlay').style.display = 'flex';
    loadingText.textContent = '正在為您即時計算群組績效...';

    try {
        const result = await apiRequest('calculate_group_on_demand', { groupId });
        if (result.success) {
            const { holdings, summary, history, twrHistory, benchmarkHistory, netProfitHistory } = result.data;
            
            const holdingsObject = (holdings || []).reduce((obj, item) => {
                obj[item.symbol] = item; return obj;
            }, {});

            setState({
                holdings: holdingsObject,
                summary,
                portfolioHistory: history,
                twrHistory,
                benchmarkHistory,
                netProfitHistory
            });

            // 更新 UI
            updateDashboard(holdingsObject, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
            renderHoldingsTable(holdingsObject);
            
            const { groups } = getState();
            const selectedGroup = groups.find(g => g.id === groupId);
            const seriesName = selectedGroup ? selectedGroup.name : '群組';

            updateAssetChart(seriesName);
            updateNetProfitChart(seriesName);
            updateTwrChart(summary?.benchmarkSymbol || 'SPY', seriesName);

            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        showNotification('error', `計算群組績效失敗: ${error.message}`);
        document.getElementById('group-selector').value = 'all';
        setState({ selectedGroupId: 'all' });
        await fetchAllCoreData(); // 失敗時，回退到全局視圖
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}
// ========================= 【核心修改 - 結束】 =========================