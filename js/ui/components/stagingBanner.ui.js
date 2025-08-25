// =========================================================================================
// == [修正檔案] 暫存區橫幅 UI 模組 (stagingBanner.ui.js) v1.1 - 修正提交後刷新邏輯
// == 職責：處理全局提示橫幅的顯示、隱藏與互動邏輯。
// =========================================================================================

import { getState, setState } from '../../state.js';
import { apiRequest } from '../../api.js';
import { showNotification } from '../notifications.js';
import { renderTransactionsTable } from './transactions.ui.js';
// ========================= 【核心修改 - 開始】 =========================
import { renderHoldingsTable } from './holdings.ui.js';
import { updateDashboard } from '../dashboard.js';
import { updateAssetChart } from '../charts/assetChart.js';
import { updateTwrChart } from '../charts/twrChart.js';
import { updateNetProfitChart } from '../charts/netProfitChart.js';
// ========================= 【核心修改 - 結束】 =========================


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
        const stagedCount = transactions.filter(t => t.status && t.status !== 'COMMITTED').length;
        countElement.textContent = stagedCount;
        
        banner.classList.remove('hidden');
        lucide.createIcons({ nodes: [banner.querySelector('i')] });
        
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

            try {
                const result = await apiRequest('commit_all_changes');
                if (result.success) {
                    showNotification('success', result.message);
                    
                    // ========================= 【核心修改 - 開始】 =========================
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

                    // 重新渲染所有相關的UI元件
                    const { summary } = getState();
                    updateDashboard(newHoldings, summary?.totalRealizedPL, summary?.overallReturnRate, summary?.xirr);
                    renderHoldingsTable(newHoldings);
                    renderTransactionsTable();
                    
                    const { selectedGroupId, groups } = getState();
                    let seriesName = '投資組合'; 
                    if (selectedGroupId && selectedGroupId !== 'all') {
                        const selectedGroup = groups.find(g => g.id === selectedGroupId);
                        if (selectedGroup) seriesName = selectedGroup.name; 
                    }
                    updateAssetChart(seriesName);
                    updateNetProfitChart(seriesName);
                    const benchmarkSymbol = summary?.benchmarkSymbol || 'SPY';
                    updateTwrChart(benchmarkSymbol, seriesName);
                    // ========================= 【核心修改 - 結束】 =========================

                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                showNotification('error', `提交失敗: ${error.message}`);
                 // 如果提交失敗，重新從後端同步一次狀態
                const { reloadTransactionsAndUpdateUI } = await import('../../events/transaction.events.js');
                reloadTransactionsAndUpdateUI();
            } finally {
                setState({ isCommitting: false });
                updateStagingBanner();
            }
        });
    }

    if (discardButton) {
        discardButton.addEventListener('click', async () => {
            const { showConfirm } = await import('../modals.js');
            const { transactions } = getState();
            const stagedCount = transactions.filter(t => t.status && t.status !== 'COMMITTED').length;

            showConfirm(`您確定要捨棄 ${stagedCount} 筆未提交的變更嗎？此操作無法復原。`, async () => {
                try {
                    const result = await apiRequest('discard_all_changes');
                    if (result.success) {
                        showNotification('info', '所有變更已捨棄。');
                        
                        // 【修正】捨棄後，直接從後端重新獲取乾淨的列表，確保狀態正確
                        const { reloadTransactionsAndUpdateUI } = await import('../../events/transaction.events.js');
                        await reloadTransactionsAndUpdateUI();
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