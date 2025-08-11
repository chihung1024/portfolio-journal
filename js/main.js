// =========================================================================================
// == 主程式進入點 (main.js) v3.8.0 - Final Refactor
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, loadPortfolioData } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';

// --- UI Module Imports ---
import { initializeAssetChart } from './ui/charts/assetChart.js';
import { initializeTwrChart } from './ui/charts/twrChart.js';
import { initializeNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderDividendsManagementTab } from './ui/components/dividends.ui.js';
import { hideConfirm, toggleOptionalFields } from './ui/modals.js';
import { switchTab } from './ui/tabs.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';

// --- 主流程函式 ---

// 註：此函式由通用的 switchTab 邏輯(main.js)和 dividend.events.js 共同呼叫，因此匯出
export async function loadAndShowDividends() {
    const { renderDividendsManagementTab } = await import('./ui/components/dividends.ui.js');
    const { showNotification } = await import('./ui/notifications.js');

    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';
    try {
        const result = await apiRequest('get_dividends_for_management', {});
        if (result.success) {
            setState({
                pendingDividends: result.data.pendingDividends,
                confirmedDividends: result.data.confirmedDividends,
            });
            renderDividendsManagementTab(result.data.pendingDividends, result.data.confirmedDividends);
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        showNotification('error', `讀取配息資料失敗: ${error.message}`);
    } finally {
        overlay.style.display = 'none';
    }
}

// 註冊與認證無關的、全域只需註冊一次的事件
function setupCommonEventListeners() {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirm);
    document.getElementById('confirm-ok-btn').addEventListener('click', () => { 
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); } 
        hideConfirm(); 
    });
}

// 註冊登入後 App 核心互動邏輯的事件監聽
function setupMainAppEventListeners() {
    // 登出按鈕
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // 主內容區的分頁切換
    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            if (tabName === 'dividends') {
                await loadAndShowDividends();
            } else if (tabName === 'transactions') {
                const { renderTransactionsTable } = await import('./ui/components/transactions.ui.js');
                renderTransactionsTable();
            }
        }
    });
    
    // 交易表單中的幣別選擇（會影響可選欄位）
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);
}

// App UI 初始化總入口
export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");
    
    // 1. 初始化所有圖表
    initializeAssetChart();
    initializeTwrChart();
    initializeNetProfitChart();
    
    // 2. 註冊所有事件監聽
    // 使用 setTimeout 確保所有 DOM 元素都已渲染完成
    setTimeout(() => {
        setupMainAppEventListeners();
        initializeTransactionEventListeners();
        initializeSplitEventListeners();
        initializeDividendEventListeners();
        initializeGeneralEventListeners();
        lucide.createIcons();
    }, 0);

    setState({ isAppInitialized: true });
}

// 網頁載入完成後的主入口
document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
