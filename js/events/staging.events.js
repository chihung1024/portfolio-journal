// js/events/staging.events.js

import { api } from '../api.js';
import { renderStagingArea } from '../ui/components/staging.ui.js';
import { showNotification } from '../ui/notifications.js';
import { stagingService } from '../staging.service.js';
import state from '../state.js';

export function setupStagingEventListeners() {
    const stagingTab = document.getElementById('staging-tab');
    const stagingContent = document.getElementById('staging-content');

    if (stagingTab) {
        stagingTab.addEventListener('click', async () => {
            await stagingService.fetchStagedActions();
            renderStagingArea();
        });
    }

    if (stagingContent) {
        stagingContent.addEventListener('click', async (event) => {
            const commitBtn = event.target.closest('#commit-staged-btn');
            const discardBtn = event.target.closest('.discard-action-btn');

            if (commitBtn) {
                const checkboxes = stagingContent.querySelectorAll('.action-checkbox:checked');
                const selectedIds = Array.from(checkboxes).map(cb => cb.dataset.actionId);

                if (selectedIds.length === 0) {
                    showNotification('請至少選擇一個要提交的項目。', 'warning');
                    return;
                }

                try {
                    commitBtn.disabled = true;
                    commitBtn.textContent = '提交中...';
                    
                    // 從暫存區服務獲取完整的 action payload
                    const actionsToCommit = (await stagingService.getStagedActions()).filter(action => selectedIds.includes(action.id));

                    await api.commitStagedActions({ actions: actionsToCommit });

                    showNotification('暫存區的變更已成功提交。', 'success');
                    
                    // 刷新全局數據
                    await Promise.all([
                        api.getHoldings(),
                        api.getTransactions(),
                        api.getDividends(),
                        api.getSplits(),
                        api.getGroups(),
                        api.getClosedPositions()
                    ]);
                    
                    // 刷新暫存區
                    await stagingService.fetchStagedActions();
                    renderStagingArea();
                    
                } catch (error) {
                    console.error('Error committing staged actions:', error);
                    showNotification(`提交失敗：${error.message}`, 'error');
                } finally {
                    commitBtn.disabled = false;
                    commitBtn.textContent = '提交選定項目';
                }
            }

            if (discardBtn) {
                const actionId = discardBtn.dataset.actionId;
                if (confirm('確定要捨棄此項變更嗎？此操作無法復原。')) {
                    try {
                        await stagingService.discardAction(actionId);
                        showNotification('指定的變更已從暫存區移除。', 'info');
                        renderStagingArea();
                    } catch (error) {
                        console.error('Error discarding action:', error);
                        showNotification(`捨棄失敗：${error.message}`, 'error');
                    }
                }
            }
        });
    }
}
