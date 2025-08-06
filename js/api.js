// =========================================================================================
// == API 通訊模組 (api.js)
// =========================================================================================

import { API } from './config.js';
import { getState, setState } from './state.js';
import { 
    renderHoldingsTable, 
    renderTransactionsTable, 
    renderSplitsTable, 
    updateDashboard, 
    updateAssetChart, 
    updateTwrChart,
    showNotification
} from './ui.js';

/**
 * 統一的後端 API 請求函式
 * @param {string} action - 要執行的操作名稱
 * @param {object} data - 要傳送的資料
 * @returns {Promise<object>} - 後端返回的結果
 */
export async function apiRequest(action, data) {
    const { currentUserId } = getState();
    if (!currentUserId) {
        showNotification('error', '請先登入再執行操作。');
        throw new Error('User not logged in');
    }

    const payload = { action, uid: currentUserId, data };
    console.log("即將發送到後端的完整 Payload:", JSON.stringify(payload, null, 2));
    
    const response = await fetch(API.URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': API.KEY
        },
        body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    if (!response.ok) {
        console.error("後端返回的錯誤詳情:", result); 
        throw new Error(result.message || '伺服器發生錯誤');
    }
    return result;
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
        const result = await apiRequest('get_data', {}); // data 為空物件，因為 uid 已在 apiRequest 中處理
        
        const portfolioData = result.data;
        
        // 更新全域狀態
        setState({
            transactions: portfolioData.transactions || [],
            userSplits: portfolioData.splits || [],
            marketDataForFrontend: portfolioData.marketData || {}
        });
        
        const holdingsObject = (portfolioData.holdings || []).reduce((obj, item) => {
            obj[item.symbol] = item; return obj;
        }, {});
        
        renderHoldingsTable(holdingsObject);
        renderTransactionsTable(); 
        renderSplitsTable();
        updateDashboard(holdingsObject, portfolioData.summary?.totalRealizedPL, portfolioData.summary?.overallReturnRate, portfolioData.summary?.xirr);
        updateAssetChart(portfolioData.history || {});
        const benchmarkSymbol = portfolioData.summary?.benchmarkSymbol || 'SPY';
        updateTwrChart(portfolioData.twrHistory || {}, portfolioData.benchmarkHistory || {}, benchmarkSymbol);
        document.getElementById('benchmark-symbol-input').value = benchmarkSymbol;
        showNotification('success', '資料同步完成！');
    } catch (error) {
        console.error('Failed to load portfolio data:', error);
        showNotification('error', `讀取資料失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}
