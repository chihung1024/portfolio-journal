// =========================================================================================
// == API 通訊模組 (api.js) v3.5.1
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
    updateNetProfitChart, // 【新增此行】
    showNotification,
    getDateRangeForPreset
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
    try {
        const result = await apiRequest('get_data', {});
        
        const portfolioData = result.data;
        
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
            marketDataForFrontend: portfolioData.marketData || {},
            stockNotes: stockNotesMap,
            holdings: holdingsObject,
            portfolioHistory: portfolioData.history || {},
            twrHistory: portfolioData.twrHistory || {},
            benchmarkHistory: portfolioData.benchmarkHistory || {},
            netProfitHistory: portfolioData.netProfitHistory || {}
        });
        
        // 渲染表格與儀表板
        renderHoldingsTable(holdingsObject);
        renderTransactionsTable(); 
        renderSplitsTable();
        updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);
        
        // --- 【修改】調整執行順序 ---

        // 1. 先設定好所有圖表的預設日期
        document.getElementById('benchmark-symbol-input').value = portfolioData.summary?.benchmarkSymbol || 'SPY';

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

        // 2. 在日期都設定好之後，才更新圖表
        updateAssetChart(); 
        updateNetProfitChart();
        updateTwrChart(portfolioData.summary?.benchmarkSymbol || 'SPY');
        
        showNotification('success', '資料同步完成！');
    } catch (error) {
        console.error('Failed to load portfolio data:', error);
        showNotification('error', `讀取資料失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}
