// =========================================================================================
// == API 通訊模組 (api.js) v4.0.0 - 支援群組視圖計算
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
 * 【新增】高階 API 執行器，封裝了載入狀態、通知和數據刷新邏輯
 * @param {string} action - 要執行的 API action 名稱
 * @param {object} payload - 傳遞給 API 的數據
 * @param {object} options - 選項配置
 * @param {string} options.loadingText - 載入時顯示的文字
 * @param {string} options.successMessage - 操作成功時顯示的通知訊息
 * @param {boolean} [options.shouldRefreshData=true] - 操作成功後是否需要刷新整個投資組合數據
 * @returns {Promise<object>} - 返回 API 的原始成功結果
 */
export async function executeApiAction(action, payload, { loadingText = '正在同步至雲端...', successMessage, shouldRefreshData = true }) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = loadingText;
    loadingOverlay.style.display = 'flex';

    try {
        const result = await apiRequest(action, payload);

        // 只有在操作成功後才刷新數據
        if (shouldRefreshData) {
            await loadPortfolioData();
        }

        // 在數據刷新後再顯示成功訊息，體驗更流暢
        if (successMessage) {
            showNotification('success', successMessage);
        }

        return result; 
    } catch (error) {
        showNotification('error', `操作失敗: ${error.message}`);
        throw error; 
    } finally {
        loadingOverlay.style.display = 'none';
        loadingTextElement.textContent = '正在從雲端同步資料...'; // 恢復預設文字
    }
}


/**
 * 【核心修改】一個統一的函式，用來接收計算結果並更新整個 App 的 UI
 */
function updateAppWithData(portfolioData) {
    const stockNotesMap = (portfolioData.stockNotes || []).reduce((map, note) => {
        map[note.symbol] = note;
        return map;
    }, {});

    const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});

    // ========================= 【核心修正 - 開始】 =========================
    // 步驟 1: 更新 State 中的歷史數據，並「同時重置」日期範圍的狀態
    setState({

        stockNotes: stockNotesMap,
        holdings: holdingsObject,
        portfolioHistory: portfolioData.history || {},
        twrHistory: portfolioData.twrHistory || {},
        benchmarkHistory: portfolioData.benchmarkHistory || {},
        netProfitHistory: portfolioData.netProfitHistory || {},
        // **重置日期範圍狀態**
        assetDateRange: { type: 'all', start: null, end: null },
        twrDateRange: { type: 'all', start: null, end: null },
        netProfitDateRange: { type: 'all', start: null, end: null }
    });

    // 步驟 2: 手動更新所有圖表控制按鈕的 UI，確保 "全部" 按鈕被選中
    ['asset', 'twr', 'net-profit'].forEach(chartType => {
        const controls = document.getElementById(`${chartType}-chart-controls`);
        if (controls) {
            controls.querySelectorAll('.chart-range-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.range === 'all') {
                    btn.classList.add('active');
                }
            });
        }
    });
    // ========================= 【核心修正 - 結束】 =========================

    // 渲染 UI
    renderHoldingsTable(holdingsObject);
    renderTransactionsTable(); 
    renderSplitsTable();
    updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);

    updateAssetChart(); 
    updateNetProfitChart();
    const benchmarkSymbol = portfolioData.summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(benchmarkSymbol);

    document.getElementById('benchmark-symbol-input').value = benchmarkSymbol;

    // 更新圖表日期範圍選擇器
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
    const { currentUserId } = getState();
    if (!currentUserId) {
        console.log("未登入，無法載入資料。");
        return;
    }
    document.getElementById('loading-overlay').style.display = 'flex';
    try {
        const result = await apiRequest('get_data', {});

        // 【修改】將 UI 更新邏輯抽離到新函式
        updateAppWithData(result.data);

        // 額外設定母數據
        setState({
            transactions: result.data.transactions || [],
            userSplits: result.data.splits || [],
        });

        // showNotification('success', '資料同步完成！'); // 在 executeApiAction 中統一處理
    } catch (error) {
        console.error('Failed to load portfolio data:', error);
        showNotification('error', `讀取資料失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

/**
 * 【新增】請求後端按需計算特定群組的數據，並更新畫面
 */
export async function applyGroupView(groupId) {
    if (!groupId || groupId === 'all') {
        await loadPortfolioData(); // 如果是'all'，就載入完整的儲存數據
        return;
    }

    const loadingText = document.getElementById('loading-text');
    document.getElementById('loading-overlay').style.display = 'flex';
    loadingText.textContent = '正在為您即時計算群組績效...';

    try {
        const result = await apiRequest('calculate_group_on_demand', { groupId });
        if (result.success) {
            // 直接使用回傳的一次性計算結果來更新 UI
            updateAppWithData(result.data);
            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        showNotification('error', `計算群組績效失敗: ${error.message}`);
        // 如果失敗，可以選擇切回 'all' 視圖
        document.getElementById('group-selector').value = 'all';
        await loadPortfolioData();
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...'; // 恢復預設文字
    }
}
