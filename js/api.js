// =========================================================================================
// == API 通訊模組 (api.js)
// =========================================================================================

// [新增] 從 Firebase SDK 引入 getAuth，用來獲取當前使用者
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
    showNotification
} from './ui.js';

/**
 * [安全性強化版] 統一的後端 API 請求函式
 */
export async function apiRequest(action, data) {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
        showNotification('error', '請先登入再執行操作。');
        throw new Error('User not logged in');
    }

    try {
        // [關鍵修改] 非同步獲取當前使用者的 Firebase ID Token
        const token = await user.getIdToken();

        // [關鍵修改] payload 中不再需要手動放入 uid
        const payload = { action, data };

        const response = await fetch(API.URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`, // [新增] 將 Token 作為 Bearer Token 加入到標頭中
                'X-API-KEY': API.KEY
            },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        if (!response.ok) {
            // 如果認證失敗，後端會回傳 401 或 403
            if (response.status === 401 || response.status === 403) {
                 throw new Error(result.message || '認證失敗，您的登入可能已過期，請嘗試重新整理頁面。');
            }
            throw new Error(result.message || '伺服器發生錯誤');
        }
        return result;

    } catch (error) {
        console.error('API 請求失敗:', error);
        // 將錯誤直接拋出，讓呼叫它的地方 (例如 handleFormSubmit) 可以捕獲並顯示通知
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
        
        // [修改] 將 stockNotes 轉換為以 symbol 為 key 的物件，方便查找
        const stockNotesMap = (portfolioData.stockNotes || []).reduce((map, note) => {
            map[note.symbol] = note;
            return map;
        }, {});

        // 更新全域狀態
        setState({
            transactions: portfolioData.transactions || [],
            userSplits: portfolioData.splits || [],
            marketDataForFrontend: portfolioData.marketData || {},
            stockNotes: stockNotesMap
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
