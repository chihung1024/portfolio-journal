// =========================================================================================
// == 主程式進入點 (main.js) v4.0.1 - Import Fix
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
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js'; // Import for tab switching
import { showNotification } from './ui/notifications.js'; // 【核心修正】在這裡引入 showNotification

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeGroupEventListeners, loadGroups } from './events/group.events.js';

// --- 主流程函式 ---

export async function loadAndShowDividends() {
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
            } else if (tabName === 'groups') {
                renderGroupsTab();
            }
        }
    });
    
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);

    const groupSelector = document.getElementById('group-selector');
    const recalcBtn = document.getElementById('recalculate-group-btn');

    groupSelector.addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });
        if (selectedGroupId === 'all') {
            recalcBtn.classList.add('hidden');
            loadPortfolioData();
        } else {
            recalcBtn.classList.remove('hidden');
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
    
    loadGroups();
    
    setTimeout(() => {
        setupMainAppEventListeners();
        initializeTransactionEventListeners();
        initializeSplitEventListeners();
        initializeDividendEventListeners();
        initializeGeneralEventListeners();
        initializeGroupEventListeners();
        lucide.createIcons();
    }, 0);

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
