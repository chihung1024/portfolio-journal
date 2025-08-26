// =========================================================================================
// == 暫存區橫幅 UI 模組 (stagingBanner.ui.js) v2.1 - Final Cleanup
// == 職責：處理全局提示橫幅的顯示、隱藏與互動邏輯，並在提交成功後刷新整個應用。
// =========================================================================================

import { getState, setState } from '../../state.js';
import { apiRequest } from '../../api.js';
import { showNotification } from '../notifications.js';
import { renderTransactionsTable } from './transactions.ui.js';
import { renderHoldingsTable } from './holdings.ui.js';
import { updateDashboard } from '../dashboard.js';
import { updateAssetChart } from '../charts/assetChart.js';
import { updateTwrChart } from '../charts/twrChart.js';
import { updateNetProfitChart } from '../charts/netProfitChart.js';
// 【修改】統一導入職責更清晰的全局刷新函式
import { refreshAllStagedViews } from '../main.js';

/**
 * 根據當前的暫存區狀態，更新橫幅的顯示或隱藏
 */
export function updateStagingBanner() {
    const { hasStagedChanges, isCommitting, transactions } = getState();
    const banner = document.getElementById('staging-banner');
    const countElement = document.getElementById('staged-changes-count');
    const commitButton = document.getElementById('commit-all-btn');
    const discardButton = document.getElementById('discard-all-btn');

    if (!banner || !countElement || !commitButton || !discardButton) {
        return;
    }
    
    if (hasStagedChanges) {
        // TODO: This count is not accurate as it only counts transactions.
        // For now, we provide a generic message.
        const stagedTxCount = (transactions || []).filter(t => t.status && t.status !== 'COMMITTED').length;
        countElement.textContent = stagedTxCount > 0 ? stagedTxCount : '多筆';
        
        banner.classList.remove('hidden');
        
        if (isCommitting) {
            commitButton.disabled = true;
            discardButton.disabled = true;
            commitButton.innerHTML = `<svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>提交中...`;
            commitButton.classList.add('opacity-50', 'cursor-not-allowed', 'flex', 'items-center');
        } else {
            commitButton.disabled = false;
            discardButton.disabled = false;
            commitButton.innerHTML = '全部提交';
            commitButton.classList.remove('opacity-50', 'cursor-not-allowed', 'flex', 'items-center');
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
            updateStagingBanner(); 

            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingText = document.getElementById('loading-text');
            loadingText.textContent = '正在提交變更並重算績效...';
            loadingOverlay.style.display = 'flex';

            try {
                const result = await apiRequest('commit_all_changes');
                if (result.success) {
                    showNotification('success', result.message);
                    
                    const newHoldings = (result.data.holdings || []).reduce((obj, item) => {
                        obj[item.symbol] = item; return obj;
                    }, {});
                    const newStockNotes = (result.data.stockNotes || []).reduce((map, note) => {
                        map[note.symbol] = note; return map;
                    }, {});

                    setState({
                        transactions: result.data.transactions || [],
                        holdings: newHoldings,
                        summary: result.data.summary,
                        portfolioHistory: result.data.history || {},
                        twrHistory: result.data.twrHistory || {},
                        benchmarkHistory: result.data.benchmarkHistory || {},
                        netProfitHistory: result.data.netProfitHistory || {},
                        userSplits: result.data.splits || [],
                        stockNotes: newStockNotes,
                        hasStagedChanges: false,
                    });

                    const { summary, selectedGroupId, groups } = getState();
                    updateDashboard(newHoldings, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
                    renderHoldingsTable(newHoldings);
                    renderTransactionsTable();
                    
                    let seriesName = '投資組合'; 
                    if (selectedGroupId && selectedGroupId !== 'all') {
                        const selectedGroup = groups.find(g => g.id === selectedGroupId);
                        if (selectedGroup) seriesName = selectedGroup.name; 
                    }
                    updateAssetChart(seriesName);
                    updateNetProfitChart(seriesName);
                    const benchmarkSymbol = summary?.benchmarkSymbol || 'SPY';
                    updateTwrChart(benchmarkSymbol, seriesName);
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                showNotification('error', `提交失敗: ${error.message}`);
                await refreshAllStagedViews(); // 【修改】統一呼叫
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
            showConfirm(`您確定要捨棄所有未提交的變更嗎？此操作無法復原。`, async () => {
                try {
                    const result = await apiRequest('discard_all_changes');
                    if (result.success) {
                        showNotification('info', '所有變更已捨棄。');
                        await refreshAllStagedViews(); // 【修改】統一呼叫
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