// =========================================================================================
// == API 通訊模組 (api.js) v5.0.0 - 支援請求中止與細粒度狀態
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
 * 【核心修改】增加 AbortSignal 支援，用於取消請求
 * @param {string} action - The API action to perform.
 * @param {object} data - The payload for the action.
 * @param {AbortSignal} signal - The signal to abort the fetch request.
 */
export async function apiRequest(action, data, signal) {
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
            body: JSON.stringify(payload),
            signal: signal, // <--- 【新增】將 AbortSignal 傳入 fetch
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
        if (error.name === 'AbortError') {
            console.log('API request was aborted.', { action });
            // 丟出一個特定錯誤，讓呼叫者可以捕獲並忽略
            throw new Error('Aborted');
        }
        console.error('API 請求失敗:', error);
        throw error;
    }
}

/**
 * 高階 API 執行器，封裝了載入狀態、通知和數據刷新邏輯
 * 【核心修改】不再控制全螢幕 loading，而是管理 committing 狀態
 */
export async function executeApiAction(action, payload, { loadingText = '正在同步至雲端...', successMessage, shouldRefreshData = true }) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');

    // 【修改】現在只在提交操作時顯示全螢幕遮罩
    setState({ isLoading: { ...getState().isLoading, committing: true } });
    loadingTextElement.textContent = loadingText;
    loadingOverlay.style.display = 'flex';

    try {
        const result = await apiRequest(action, payload);

        if (shouldRefreshData) {
            // 注意：loadPortfolioData 現在已被分解，此處可能需要呼叫一個新的、完整的刷新函式
            await loadPortfolioData();
        }

        if (successMessage) {
            showNotification('success', successMessage);
        }

        return result;
    } catch (error) {
        if (error.message !== 'Aborted') {
            showNotification('error', `操作失敗: ${error.message}`);
        }
        throw error;
    } finally {
        setState({ isLoading: { ...getState().isLoading, committing: false } });
        loadingOverlay.style.display = 'none';
        loadingTextElement.textContent = '正在從雲端同步資料...';
    }
}


/**
 * 統一的函式，用來接收計算結果並更新整個 App 的 UI
 */
function updateAppWithData(portfolioData) {
    setState({
        transactions: portfolioData.transactions || [],
        userSplits: portfolioData.splits || [],
    });

    const stockNotesMap = (portfolioData.stockNotes || []).reduce((map, note) => {
        map[note.symbol] = note;
        return map;
    }, {});

    const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});

    setState({
        stockNotes: stockNotesMap,
        holdings: holdingsObject,
        portfolioHistory: portfolioData.history || {},
        twrHistory: portfolioData.twrHistory || {},
        benchmarkHistory: portfolioData.benchmarkHistory || {},
        netProfitHistory: portfolioData.netProfitHistory || {},
        assetDateRange: { type: 'all', start: null, end: null },
        twrDateRange: { type: 'all', start: null, end: null },
        netProfitDateRange: { type: 'all', start: null, end: null }
    });

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

    renderHoldingsTable(holdingsObject);
    renderTransactionsTable();
    renderSplitsTable();
    updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);

    const { selectedGroupId, groups } = getState();
    let seriesName = '投資組合';
    if (selectedGroupId && selectedGroupId !== 'all') {
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) {
            seriesName = selectedGroup.name;
        }
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
 * 【核心修改】此函式已被分解成多個函式，現在作為一個協調器
 */
export async function loadPortfolioData() {
    const { currentUserId, activeDataRequestController } = getState();
    if (!currentUserId) {
        console.log("未登入，無法載入資料。");
        return;
    }

    // 【新增】如果已有請求正在進行，先中止它
    if (activeDataRequestController) {
        activeDataRequestController.abort();
    }

    // 【新增】建立一個新的 AbortController 給這次的請求鏈
    const controller = new AbortController();
    setState({ activeDataRequestController: controller });

    try {
        // 【修改】不再顯示全螢幕遮罩，而是設定細粒度的載入狀態
        setState({
            isLoading: {
                ...getState().isLoading,
                summary: true,
                holdings: true,
                charts: true,
                secondaryData: true,
            }
        });
        // 觸發一次 UI 更新以顯示骨架屏
        renderHoldingsTable([]);


        const result = await apiRequest('get_data', {}, controller.signal);

        // 如果請求在完成前被中止，則直接退出
        if (controller.signal.aborted) return;

        updateAppWithData(result.data);
        showNotification('success', '所有資料已同步！');

    } catch (error) {
        if (error.message !== 'Aborted') {
            console.error('Failed to load portfolio data:', error);
            showNotification('error', `讀取資料失敗: ${error.message}`);
        }
    } finally {
        // 【修改】無論成功、失敗或中止，都清除所有載入狀態
        setState({
            isLoading: {
                ...getState().isLoading,
                summary: false,
                holdings: false,
                charts: false,
                secondaryData: false,
            }
        });
        // 清除當前的 controller
        if (getState().activeDataRequestController === controller) {
            setState({ activeDataRequestController: null });
        }
    }
}

/**
 * 請求後端按需計算特定群組的數據，並更新畫面
 * 【核心修改】整合請求中止邏輯
 */
export async function applyGroupView(groupId) {
    if (!groupId || groupId === 'all') {
        await loadPortfolioData();
        return;
    }

    const { activeDataRequestController } = getState();
    if (activeDataRequestController) {
        activeDataRequestController.abort();
    }
    const controller = new AbortController();
    setState({ activeDataRequestController: controller });

    // 【修改】不再使用全螢幕遮罩，而是設定細粒度狀態
    setState({
        isLoading: { ...getState().isLoading, holdings: true, charts: true, summary: true }
    });
    // 立即觸發骨架屏
    renderHoldingsTable([]);
    // 可以選擇性地清空圖表
    updateAssetChart();
    updateTwrChart();
    updateNetProfitChart();


    try {
        const result = await apiRequest('calculate_group_on_demand', { groupId }, controller.signal);

        if (controller.signal.aborted) return;

        if (result.success) {
            updateAppWithData(result.data);
            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        if (error.message !== 'Aborted') {
            showNotification('error', `計算群組績效失敗: ${error.message}`);
            document.getElementById('group-selector').value = 'all';
            await loadPortfolioData(); // 如果失敗，回退到載入全部數據
        }
    } finally {
        setState({
            isLoading: { ...getState().isLoading, holdings: false, charts: false, summary: false }
        });
        if (getState().activeDataRequestController === controller) {
            setState({ activeDataRequestController: null });
        }
    }
}
