// =========================================================================================
// == [新增檔案] 暫存區橫幅 UI 模組 (stagingBanner.ui.js)
// == 職責：處理全局提示橫幅的顯示、隱藏與互動邏輯。
// =========================================================================================

import { getState, setState } from '../../state.js';
import { apiRequest } from '../../api.js';
import { showNotification } from '../notifications.js';
import { renderTransactionsTable } from './transactions.ui.js';

/**
 * 根據當前的暫存區狀態，更新橫幅的顯示或隱藏
 */
export function updateStagingBanner() {
    const { hasStagedChanges, isCommitting } = getState();
    const banner = document.getElementById('staging-banner');
    const countElement = document.getElementById('staged-changes-count');
    const commitButton = document.getElementById('commit-all-btn');
    const discardButton = document.getElementById('discard-all-btn');

    if (!banner || !countElement || !commitButton || !discardButton) {
        return;
    }
    
    // 透過 API 重新獲取精確的計數
    if (hasStagedChanges) {
         apiRequest('get_transactions_with_staging', {})
            .then(result => {
                if (result.success) {
                    const stagedCount = result.data.transactions.filter(t => t.status !== 'COMMITTED').length;
                    countElement.textContent = stagedCount;
                }
            });
    }


    if (hasStagedChanges) {
        banner.classList.remove('hidden');
        lucide.createIcons({ nodes: [banner.querySelector('i')] });
        
        if (isCommitting) {
            commitButton.disabled = true;
            discardButton.disabled = true;
            commitButton.textContent = '提交中...';
        } else {
            commitButton.disabled = false;
            discardButton.disabled = false;
            commitButton.textContent = '全部提交';
        }
    } else {
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
            updateStagingBanner(); // 立即更新UI，鎖定按鈕

            try {
                // 注意：這裡直接呼叫 apiRequest 而非 executeApiAction
                // 因為成功後的回應處理更為複雜，需要手動處理
                const result = await apiRequest('commit_all_changes');
                if (result.success) {
                    showNotification('success', result.message);
                    
                    // 【核心】用後端回傳的完整新數據，重置前端所有相關狀態
                    setState({
                        transactions: result.data.transactions || [],
                        holdings: (result.data.holdings || []).reduce((obj, item) => {
                            obj[item.symbol] = item; return obj;
                        }, {}),
                        summary: result.data.summary,
                        portfolioHistory: result.data.history || {},
                        twrHistory: result.data.twrHistory || {},
                        benchmarkHistory: result.data.benchmarkHistory || {},
                        netProfitHistory: result.data.netProfitHistory || {},
                        splits: result.data.splits || [],
                        stockNotes: (result.data.stockNotes || []).reduce((map, note) => {
                            map[note.symbol] = note; return map;
                        }, {}),
                        hasStagedChanges: false, // 清除暫存狀態
                    });

                    // 【核心】手動觸發所有相關的UI重繪
                    // 順序很重要：先更新 state，再重繪所有元件
                    const { holdings, summary } = getState();
                    const dashboard = await import('../dashboard.js');
                    dashboard.updateDashboard(holdings, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
                    renderTransactionsTable();
                    // ... 這裡可以觸發所有其他圖表和表格的重繪 ...

                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                showNotification('error', `提交失敗: ${error.message}`);
            } finally {
                setState({ isCommitting: false });
                updateStagingBanner(); // 解除鎖定並根據最新狀態決定是否隱藏
            }
        });
    }

    if (discardButton) {
        discardButton.addEventListener('click', async () => {
            const { showConfirm } = await import('../modals.js');
            showConfirm('您確定要捨棄所有未提交的變更嗎？此操作無法復原。', async () => {
                try {
                    const result = await apiRequest('discard_all_changes');
                    if (result.success) {
                        showNotification('info', '所有變更已捨棄。');
                        setState({ hasStagedChanges: false });
                        
                        // 重新從後端獲取乾淨的交易列表
                        const freshData = await apiRequest('get_transactions_with_staging');
                        setState({ transactions: freshData.data.transactions || [] });
                        renderTransactionsTable();

                    } else {
                        throw new Error(result.message);
                    }
                } catch (error) {
                    showNotification('error', `操作失敗: ${error.message}`);
                } finally {
                    updateStagingBanner();
                }
            });
        });
    }
}