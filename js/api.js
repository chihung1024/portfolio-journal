// =========================================================================================
// == API 通訊模組 (api.js) v5.3.0 - Initialization Refactor
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
 * 高階 API 執行器，用於處理【立即執行】的操作 (例如拆股、筆記等)
 */
export async function executeApiAction(action, payload, { loadingText = '正在同步至雲端...', successMessage }) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingTextElement = document.getElementById('loading-text');
    loadingTextElement.textContent = loadingText;
    loadingOverlay.style.display = 'flex';
    
    try {
        const result = await apiRequest(action, payload);
        
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
 * 統一的函式，用來接收【完整】計算結果並更新整個 App 的 UI
 */
function updateAppWithData(portfolioData) {
    const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
        obj[item.symbol] = item; return obj;
    }, {});

    const stockNotesMap = (portfolioData.stockNotes || []).reduce((map, note) => {
        map[note.symbol] = note; return map;
    }, {});
    
    setState({
        transactions: portfolioData.transactions || getState().transactions,
        userSplits: portfolioData.splits || [],
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
    ['asset', 'twr', 'net-profit'].forEach(chartType => {
        const controls = document.getElementById(`${chartType}-chart-controls`);
        if(controls) {
            controls.querySelectorAll('.chart-range-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.range === 'all') btn.classList.add('active');
            });
            const historyKey = chartType === 'asset' ? 'portfolioHistory' : `${chartType}History`;
            const history = getState()[historyKey];
            const dates = getDateRangeForPreset(history, { type: 'all' });
            document.getElementById(`${chartType}-start-date`).value = dates.startDate;
            document.getElementById(`${chartType}-end-date`).value = dates.endDate;
        }
    });
}

// ========================= 【核心 Bug 修復 - 開始】 =========================
/**
 * 【移除】此函式已被廢棄
 * 它的邏輯已經被合併到 main.js 的 loadInitialDashboard 中，以建立一個更穩健、
 * 無競爭條件的應用程式啟動流程。
 */
// export async function loadInitialData() { ... }
// ========================= 【核心 Bug 修復 - 結束】 =========================


/**
 * 請求後端按需計算特定群組的數據
 */
export async function applyGroupView(groupId) {
    const loadingText = document.getElementById('loading-text');
    document.getElementById('loading-overlay').style.display = 'flex';
    loadingText.textContent = '正在為您即時計算群組績效...';

    try {
        const result = await apiRequest('calculate_group_on_demand', { groupId });
        if (result.success) {
            // 從 state 中獲取當前的交易列表，因為群組計算不應影響交易分頁的顯示
            const { transactions } = getState();
            updateAppWithData({ ...result.data, transactions });
            showNotification('success', '群組績效計算完成！');
        }
    } catch (error) {
        showNotification('error', `計算群組績效失敗: ${error.message}`);
        // 如果計算失敗，安全地切換回 'all' 視圖
        const { loadInitialDashboard } = await import('./main.js');
        document.getElementById('group-selector').value = 'all';
        setState({ selectedGroupId: 'all' });
        loadInitialDashboard();
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
        loadingText.textContent = '正在從雲端同步資料...';
    }
}
