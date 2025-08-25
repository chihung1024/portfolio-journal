// =========================================================================================
// == 暫存區橫幅 UI 模組 (stagingBanner.ui.js) v2.0 - 全面暫存
// == 職責：處理全局提示橫幅的顯示、隱藏與互動邏輯。
// =========================================================================================

import { getState, setState } from '../../state.js';
import { apiRequest } from '../../api.js';
import { showNotification } from '../notifications.js';

// ========================= 【核心修改 - 開始】 =========================
// 導入全局刷新函式
import { refreshAllStagedViews, loadInitialDashboard } from '../../app.js';
// ========================= 【核心修改 - 結束】 =========================


/**
 * 根據當前的暫存區狀態，更新橫幅的顯示或隱藏
 */
export function updateStagingBanner() {
    const { hasStagedChanges, isCommitting, transactions, confirmedDividends, userSplits, groups } = getState();
    const banner = document.getElementById('staging-banner');
    const countElement = document.getElementById('staged-changes-count');
    const commitButton = document.getElementById('commit-all-btn');
    const discardButton = document.getElementById('discard-all-btn');

    if (!banner || !countElement || !commitButton || !discardButton) return;
    
    // ========================= 【核心修改 - 開始】 =========================
    // 全面計算所有類型的暫存項目
    const getStagedCount = (items) => (items || []).filter(i => i.status && i.status !== 'COMMITTED').length;
    
    const totalStagedCount = getStagedCount(transactions) 
                             + getStagedCount(confirmedDividends) 
                             + getStagedCount(userSplits) 
                             + getStagedCount(groups);
    // ========================= 【核心修改 - 結束】 =========================

    if (totalStagedCount > 0) {
        setState({ hasStagedChanges: true });
        countElement.textContent = totalStagedCount;
        
        banner.classList.remove('hidden');
        // The lucide icon might already be created, so we check before creating.
        if (!banner.querySelector('i[data-lucide]')) {
            lucide.createIcons({ nodes: [banner.querySelector('i')] });
        }
        
        if (isCommitting) {
            commitButton.disabled = true;
            discardButton.disabled = true;
            commitButton.textContent = '提交中...';
            commitButton.classList.add('opacity-50');
        } else {
            commitButton.disabled = false;
            discardButton.disabled = false;
            commitButton.textContent = '全部提交';
            commitButton.classList.remove('opacity-50');
        }
    } else {
        setState({ hasStagedChanges: false });
        banner.classList.add('hidden');
    }
}


/**
 * 初始化暫存區橫幅的事件監聽器
 */
export function initializeStagingEventListeners() {
    const commitButton = document.getElementById('commit-all-btn');
    const discardButton = document.getElementById('discard-all-btn');

    if (commitButton) {
        commitButton.addEventListener('click', async () => {
            setState({ isCommitting: true });
            updateStagingBanner(); 

            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingText = document.getElementById('loading-text');
            loadingText.textContent = '正在提交所有變更並重算績效...';
            loadingOverlay.style.display = 'flex';

            try {
                const result = await apiRequest('commit_all_changes');
                if (result.success) {
                    showNotification('success', result.message);
                    // ========================= 【核心修改 - 開始】 =========================
                    // 提交成功後，代表後端數據已是全新，需執行最完整的儀表板重載流程
                    await loadInitialDashboard();
                    // ========================= 【核心修改 - 結束】 =========================
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                showNotification('error', `提交失敗: ${error.message}`);
                // 如果提交失敗，也重新同步一次所有暫存視圖，以確保狀態正確
                await refreshAllStagedViews();
            } finally {
                setState({ isCommitting: false });
                updateStagingBanner();
                loadingOverlay.style.display = 'none';
                loadingText.textContent = '正在處理您的請求...';
            }
        });
    }

    if (discardButton) {
        discardButton.addEventListener('click', async () => {
            const { showConfirm } = await import('../modals.js');
            const { transactions, confirmedDividends, userSplits, groups } = getState();
            const getStagedCount = (items) => (items || []).filter(i => i.status && i.status !== 'COMMITTED').length;
            const totalStagedCount = getStagedCount(transactions) + getStagedCount(confirmedDividends) + getStagedCount(userSplits) + getStagedCount(groups);

            showConfirm(`您確定要捨棄 ${totalStagedCount} 筆未提交的變更嗎？此操作無法復原。`, async () => {
                try {
                    const result = await apiRequest('discard_all_changes');
                    if (result.success) {
                        showNotification('info', '所有暫存變更已捨棄。');
                        // ========================= 【核心修改 - 開始】 =========================
                        // 捨棄後，只需執行暫存視圖刷新，即可看到所有項目恢復原狀
                        await refreshAllStagedViews();
                        // ========================= 【核心修改 - 結束】 =========================
                    } else {
                        throw new Error(result.message);
                    }
                } catch (error) {
                    showNotification('error', `操作失敗: ${error.message}`);
                }
            });
        });
    }
}