// =========================================================================================
// == [新增檔案] 暫存區橫幅 UI 模組 (stagingBanner.ui.js)
// == 職責：處理全局提示橫幅的顯示、隱藏與互動邏輯。
// =========================================================================================

import { getState } from '../../state.js';

/**
 * 根據當前的暫存區狀態，更新橫幅的顯示或隱藏
 */
export function updateStagingBanner() {
    const { hasStagedChanges, stagedChanges, isCommitting } = getState();
    const banner = document.getElementById('staging-banner');
    const countElement = document.getElementById('staged-changes-count');
    const commitButton = document.getElementById('commit-all-btn');

    if (!banner || !countElement || !commitButton) {
        console.error('Staging banner elements not found in the DOM.');
        return;
    }

    if (hasStagedChanges && !isCommitting) {
        // 有待辦事項且未在提交中 -> 顯示橫幅
        countElement.textContent = stagedChanges.length;
        banner.classList.remove('hidden');
        commitButton.disabled = false;
        commitButton.textContent = '全部提交';
    } else if (isCommitting) {
        // 正在提交中 -> 顯示橫幅並鎖定按鈕
        countElement.textContent = stagedChanges.length;
        banner.classList.remove('hidden');
        commitButton.disabled = true;
        commitButton.textContent = '提交中...';
    } else {
        // 沒有待辦事項 -> 隱藏橫幅
        banner.classList.add('hidden');
    }
}
