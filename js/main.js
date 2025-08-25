// =========================================================================================
// == 主程式進入點 (main.js) v7.1 - Correct Listener Scope
// == 職責：初始化身份驗證、綁定頂層事件監聽器、啟動應用程式。
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, applyGroupView } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';
import { initializeAppUI, loadInitialDashboard, loadAndShowDividends } from './app.js';
import { renderTransactionsTable } from './ui/components/transactions.ui.js';
import { renderSplitsTable } from './ui/components/splits.ui.js';
import { renderGroupsTab } from './ui/components/groups.ui.js';
import { switchTab } from './ui/tabs.js';

/**
 * 綁定通用事件監聽器（無論登入與否都應生效）
 */
function setupCommonEventListeners() {
    // 登入/註冊按鈕
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);

    // 全局確認對話框按鈕
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

    // 為所有彈出視窗的取消按鈕和背景遮罩，統一綁定關閉事件
    document.querySelectorAll('[data-modal-id]').forEach(modal => {
        const modalId = modal.dataset.modalId;
        const cancelButton = modal.querySelector(`.cancel-btn[data-modal-cancel="${modalId}"]`);
        if (cancelButton) {
            cancelButton.onclick = () => {
                const { closeModal } = require('./ui/modals.js');
                closeModal(modalId);
            };
        }
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                const { closeModal } = require('./ui/modals.js');
                closeModal(modalId);
            }
        });
    });
}

/**
 * 綁定應用程式主體（登入後）的事件監聽器
 */
function setupMainAppEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // 主頁籤切換邏輯
    document.getElementById('tabs').addEventListener('click', async (e) => {
        const tabItem = e.target.closest('.tab-item');
        if (tabItem && !tabItem.classList.contains('active')) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            
            switch (tabName) {
                case 'dividends':
                    await loadAndShowDividends();
                    break;
                case 'transactions':
                    renderTransactionsTable();
                    break;
                case 'groups':
                    renderGroupsTab();
                    break;
                case 'splits':
                    renderSplitsTable();
                    break;
            }
        }
    });
    
    // 全局群組選擇器邏輯
    document.getElementById('group-selector').addEventListener('change', (e) => {
        const selectedGroupId = e.target.value;
        setState({ selectedGroupId });

        if (selectedGroupId === 'all') {
            loadInitialDashboard();
        } else {
            applyGroupView(selectedGroupId);
        }
    });

    // ========================= 【核心修改 - 開始】 =========================
    // 通用事件（如圖表、持股列表互動）只應在登入後初始化
    const { initializeGeneralEventListeners } = require('./events/general.events.js');
    initializeGeneralEventListeners();
    // ========================= 【核心修改 - 結束】 =========================
}

/**
 * 應用程式啟動函式
 */
export function startApp(user) {
    setState({ currentUserId: user.uid });

    document.getElementById('auth-container').style.display = 'none';
    document.querySelector('main').classList.remove('hidden');
    document.getElementById('user-info').classList.remove('hidden');
    document.getElementById('user-id').textContent = user.email;
    
    if (!getState().isAppInitialized) {
        initializeAppUI();
        setupMainAppEventListeners();
        setState({ isAppInitialized: true });
    }
    
    loadInitialDashboard();
}

// 當 DOM 載入完成後，立即初始化通用事件和 Firebase 認證
document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});