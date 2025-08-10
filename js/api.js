// =========================================================================================
// == API 通訊模組 (api.js) v3.6.1 - 修正 updateDashboard 參數錯誤
// =========================================================================================

import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { API } from './config.js';
import { getState, setState } from './state.js';
import { 
    renderHoldingsTable, 
    renderTransactionsTable, 
    renderSplitsTable, 
    updateDashboard, 
    updateAssetChart, 
    updateTwrChart,
    updateNetProfitChart,
    updateDividendsTabIndicator,
    showNotification,
    getDateRangeForPreset,
    updateUIWithData // 確保引入 updateUIWithData
} from './ui.js';

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
 * 從後端載入所有投資組合資料並更新畫面
 */
export async function loadPortfolioData() {
    const { currentUserId } = getState();
    if (!currentUserId) {
        console.log("未登入，無法載入資料。");
        return;
    }
    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('loading-text').textContent = '正在從雲端同步資料...';

    try {
        const result = await apiRequest('get_data', {});
        
        const portfolioData = result.data;

        setState({ fullPortfolioData: portfolioData });
        
        const stockNotesMap = (portfolioData.stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note;
            return map;
        }, {});

        const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
        
        setState({
            transactions: portfolioData.transactions || [],
            userSplits: portfolioData.splits || [],
            stockNotes: stockNotesMap,
            holdings: holdingsObject,
            portfolioHistory: portfolioData.history || {},
            twrHistory: portfolioData.twrHistory || {},
            benchmarkHistory: portfolioData.benchmarkHistory || {},
            netProfitHistory: portfolioData.netProfitHistory || {},
            pendingDividendsCount: portfolioData.pendingDividendsCount || 0
        });
        
        renderHoldingsTable(holdingsObject);
        renderTransactionsTable(); 
        renderSplitsTable();
        
        // 【關鍵修正】將呼叫 updateDashboard 的參數順序修正
        updateDashboard(portfolioData.summary, holdingsObject);
        
        updateAssetChart(portfolioData.history); 
        updateNetProfitChart(portfolioData.netProfitHistory);
        const benchmarkSymbol = portfolioData.summary?.benchmarkSymbol || 'SPY';
        updateTwrChart(portfolioData.twrHistory, portfolioData.benchmarkHistory, benchmarkSymbol);
        
        updateDividendsTabIndicator();

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
        
        showNotification('success', '資料同步完成！');
    } catch (error) {
        console.error('Failed to load portfolio data:', error);
        showNotification('error', `讀取資料失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}


// =========================================================================================
// == 群組功能相關 API 函式
// =========================================================================================

export async function loadGroups() {
    const result = await apiRequest('get_groups');
    if (result.success) {
        setState({ groups: result.data });
        return result.data;
    }
    throw new Error(result.message || '載入群組失敗');
}

export async function saveGroup(groupData) {
    return await apiRequest('save_group', groupData);
}

export async function deleteGroup(id) {
    return await apiRequest('delete_group', { id });
}

export async function calculateBySymbols(symbols) {
    const result = await apiRequest('calculate_by_symbols', { symbols });
    if (result.success) {
        return result.data;
    }
    throw new Error(result.message || '群組計算失敗');
}
