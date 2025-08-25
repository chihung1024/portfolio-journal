// =========================================================================================
// == 暫存區橫幅 UI 模組 (stagingBanner.ui.js) v2.1 - 後端驅動
// == 職責：處理全局提示橫幅的顯示、隱藏與互動邏輯。
// =========================================================================================

import { getState, setState } from '../../state.js';
import { apiRequest } from '../../api.js';
import { showNotification } from '../notifications.js';
import { refreshAllStagedViews, loadInitialDashboard } from '../../app.js';

/**
 * 從後端獲取最新暫存狀態，並據此更新橫幅的顯示或隱藏
 * 這是更新橫幅的唯一權威方法。
 */
export async function updateStagingBanner() {
    const { isCommitting } = getState();
    const banner = document.getElementById('staging-banner');
    const countElement = document.getElementById('staged-changes-count');
    const commitButton = document.getElementById('commit-all-btn');
    const discardButton = document.getElementById('discard-all-btn');

    if (!banner || !countElement || !commitButton || !discardButton) return;

    try {
        const result = await apiRequest('get_staging_summary');
        if (!result.success) throw new Error(result.message);

        const { totalStagedCount, hasStagedChanges } = result.data;
        setState({ hasStagedChanges });

        if (hasStagedChanges) {
            countElement.textContent = totalStagedCount;
            banner.classList.remove('hidden');
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
            banner.classList.add('hidden');
        }
    } catch (error) {
        console.error("獲取暫存區摘要失敗:", error);
        showNotification('error', '無法更新暫存區狀態，請稍後再試。');
        banner.classList.add('hidden');
        setState({ hasStagedChanges: false });
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
            updateStagingBanner(); // 更新 UI 為 "提交中..." 狀態

            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingText = document.getElementById('loading-text');
            loadingText.textContent = '正在提交所有變更並重算績效...';
            loadingOverlay.style.display = 'flex';

            try {
                const result = await apiRequest('commit_all_changes');
                if (result.success) {
                    showNotification('success', result.message);
                    await loadInitialDashboard();
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                showNotification('error', `提交失敗: ${error.message}`);
                await refreshAllStagedViews();
            } finally {
                setState({ isCommitting: false });
                updateStagingBanner(); // 無論成功或失敗，都再次從後端同步最新狀態
                loadingOverlay.style.display = 'none';
                loadingText.textContent = '正在處理您的請求...';
            }
        });
    }

    if (discardButton) {
        discardButton.addEventListener('click', async () => {
            const { showConfirm } = await import('../modals.js');
            const totalStagedCount = document.getElementById('staged-changes-count').textContent || '多筆';

            showConfirm(`您確定要捨棄 ${totalStagedCount} 筆未提交的變更嗎？此操作無法復原。`, async () => {
                try {
                    const result = await apiRequest('discard_all_changes');
                    if (result.success) {
                        showNotification('info', '所有暫存變更已捨棄。');
                        await refreshAllStagedViews();
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

/**
 * 撤銷單一暫存變更
 * @param {string} changeId - 要撤銷的變更 ID
 */
export async function revertSingleChange(changeId) {
    try {
        const result = await apiRequest('revert_staged_change', { changeId });
        if (result.success) {
            showNotification('info', '該筆變更已成功撤銷。');
            await refreshAllStagedViews();
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        showNotification('error', `撤銷失敗: ${error.message}`);
    }
}
