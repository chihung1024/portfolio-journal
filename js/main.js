// =========================================================================================
// == 主程式進入點 (main.js) v6.0 - Refactored
// == 職責：初始化身份驗證、綁定頂層事件監聽器、啟動應用程式。
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, applyGroupView } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';

// ========================= 【核心修改 - 開始】 =========================
// 匯入重構後的 app.js 模組，取代原有的本地函式
import { 
    initializeAppUI, 
    loadInitialDashboard, 
    loadAndShowDividends 
} from './app.js';
// ========================= 【核心修改 - 結束】 =========================

import { renderDividendsManagementTab } from './ui/components/dividends.ui.js';
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js';
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { loadInitialData } from './api.js';


/**
 * 載入交易分頁所需的數據
 */
async function loadTransactionsData() {
    const { transactions } = getState();
    if (transactions && transactions.length > 0) {
        renderTransactionsTable();
        return;
    }
    // 如果 state 中沒有交易數據，則從後端重新載入
    await loadInitialData();
}

/**
 * 綁定只需設定一次的通用事件監聽器
 */
function setupCommonEventListeners() {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    
    // 確認對話框的按鈕事件
    document.getElementById('confirm-cancel-btn').addEventListener('click', async () => {
        const { hideConfirm } = await import('./ui/modals.js');
        hideConfirm();
    });
    document.getElementById('confirm-ok-btn').addEventListener('click', async () => { 
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); } 
        const { hideConfirm } = await import('./ui/modals.js');
        hideConfirm(); 
    });
}

/**
 * 綁定應用程式主體（登入後）的事件監聽器
 */
function setupMainAppEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // 頁籤切換邏輯
    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            
            const { userSplits } = getState();

            if (tabName === 'dividends') {
                await loadAndShowDividends();
            } else if (tabName === 'transactions') {
                await loadTransactionsData();
            } else if (tabName === 'groups') {
                renderGroupsTab();
            } else if (tabName === 'splits') {
                if(userSplits) {
                    renderSplitsTable();
                }
            }
        }
    });
    
    // 交易視窗中的貨幣切換邏輯
    document.getElementById('currency').addEventListener('change', async () => {
        const { toggleOptionalFields } = await import('./ui/modals.js');
        toggleOptionalFields();
    });

    // 全局群組選擇器邏輯
    const groupSelector = document.getElementById('group-selector');
    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });

        if (selectedGroupId === 'all') {
            // 切換回「全部股票」時，呼叫 app.js 中的全局視圖載入函式
            loadInitialDashboard();
        } else {
            // 切換到特定群組時，呼叫 api.js 中的群組計算函式
            applyGroupView(selectedGroupId);
        }
    });
}

/**
 * 應用程式啟動函式
 * @param {object} user - Firebase Auth 使用者物件
 */
export function startApp(user) {
    // 1. 更新全局狀態
    setState({ currentUserId: user.uid });

    // 2. 更新主 UI 介面
    document.getElementById('auth-container').style.display = 'none';
    document.querySelector('main').classList.remove('hidden');
    document.getElementById('logout-btn').style.display = 'block';
    document.getElementById('user-info').classList.remove('hidden');
    document.getElementById('user-id').textContent = user.email;
    document.getElementById('auth-status').textContent = '已連線';
    
    // 3. 初始化 UI 元件 (如圖表) 和非通用事件監聽器
    initializeAppUI();
    setupMainAppEventListeners();
    
    // 4. 載入儀表板數據
    loadInitialDashboard();
}

// 當 DOM 載入完成後，立即初始化通用事件和 Firebase 認證
document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});