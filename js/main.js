// =========================================================================================
// == 主程式進入點 (main.js) v4.0.0 - 整合群組管理
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, loadPortfolioData, applyGroupView } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';

// --- UI Module Imports ---
import { initializeAssetChart } from './ui/charts/assetChart.js';
import { initializeTwrChart } from './ui/charts/twrChart.js';
import { initializeNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderDividendsManagementTab } from './ui/components/dividends.ui.js';
import { hideConfirm, toggleOptionalFields } from './ui/modals.js';
import { switchTab } from './ui/tabs.js';
import { renderGroupsTab } from './ui/components/groups.ui.js'; // 【新增】

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js'; // 【新增】

// --- 主流程函式 ---

export async function loadAndShowDividends() {
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

function setupMainAppEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            // 根據不同分頁載入對應內容
            if (tabName === 'dividends') {
                await loadAndShowDividends();
            } else if (tabName === 'transactions') {
                renderTransactionsTable();
            } else if (tabName === 'groups') { // 【新增】
                renderGroupsTab();
            }
        }
    });
    
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);

    // 【新增】監聽全局群組篩選器
    const groupSelector = document.getElementById('group-selector');
    const recalcBtn = document.getElementById('recalculate-group-btn');

    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        if (selectedGroupId === 'all') {
            recalcBtn.classList.add('hidden');
            loadPortfolioData(); // 如果切回 'all', 重新載入完整的儲存數據
        } else {
            recalcBtn.classList.remove('hidden');
            // 當選擇自訂群組時，僅顯示按鈕，等待使用者點擊計算
            showNotification('info', `已選擇群組。請點擊「計算群組績效」按鈕以檢視報表。`);
        }
    });

    recalcBtn.addEventListener('click', () => {
        const { selectedGroupId } = getState();
        if (selectedGroupId && selectedGroupId !== 'all') {
            applyGroupView(selectedGroupId);
        }
    });
}

export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");
    
    initializeAssetChart();
    initializeTwrChart();
    initializeNetProfitChart();
    
    // 【新增】載入群組數據
    loadGroups();
    
    setTimeout(() => {
        setupMainAppEventListeners();
        initializeTransactionEventListeners();
        initializeSplitEventListeners();
        initializeDividendEventListeners();
        initializeGeneralEventListeners();
        initializeGroupEventListeners(); // 【新增】
        lucide.createIcons();
    }, 0);

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
