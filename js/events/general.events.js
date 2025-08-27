// =========================================================================================
// == 通用事件處理模組 (general.events.js) v5.1 - API Refactoring Fix
// =========================================================================================

import { getState, setState } from '../state.js';
// 【核心修改】移除對 executeApiAction 的導入，引入新的 fetchAllCoreData
import { apiRequest, submitBatch, fetchAllCoreData } from '../api.js';
import { stagingService } from '../staging.service.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { showNotification } from '../ui/notifications.js';
import { getDateRangeForPreset } from '../ui/utils.js';
import { updateAssetChart } from '../ui/charts/assetChart.js';
import { updateTwrChart } from '../ui/charts/twrChart.js';
import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';
import { switchDetailsTab, renderDetailsModal } from '../ui/components/detailsModal.ui.js';
import { selectCombinedTransactions } from '../selectors.js';

// --- Private Functions ---

async function handleShowDetails(symbol) {
    const { transactions, selectedGroupId } = getState();
    const hasDataLocally = transactions.some(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    const { openModal } = await import('../ui/modals.js');

    if (selectedGroupId !== 'all') {
        await openModal('details-modal', false, { symbol });
        return;
    }
    
    if (hasDataLocally) {
        await openModal('details-modal', false, { symbol });
    } else {
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        loadingText.textContent = `正在讀取 ${symbol} 的詳細資料...`;
        loadingOverlay.style.display = 'flex';
        
        try {
            const result = await apiRequest('get_symbol_details', { symbol, groupId: selectedGroupId });

            if (result.success) {
                const { transactions: newTransactions, confirmedDividends: newDividends } = result.data;
                const currentState = getState();
                const txIds = new Set(currentState.transactions.map(t => t.id));
                const uniqueNewTxs = newTransactions.filter(t => !txIds.has(t.id));
                const divIds = new Set(currentState.confirmedDividends.map(d => d.id));
                const uniqueNewDivs = newDividends.filter(d => !divIds.has(d.id));

                setState({
                    transactions: [...currentState.transactions, ...uniqueNewTxs],
                    confirmedDividends: [...currentState.confirmedDividends, ...uniqueNewDivs]
                });
                
                await openModal('details-modal', false, { symbol });
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            showNotification('error', `讀取 ${symbol} 資料失敗: ${error.message}`);
        } finally {
            loadingText.textContent = '正在從雲端同步資料...';
            loadingOverlay.style.display = 'none';
        }
    }
}

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【重構】更新 Benchmark 的事件處理器，以適應新的 API 模式
 */
async function handleUpdateBenchmark() {
    const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
    if (!newBenchmark) {
        showNotification('error', '請輸入 Benchmark 的股票代碼。');
        return;
    }

    const stagedActions = await stagingService.getStagedActions();
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    const performUpdate = async () => {
        loadingText.textContent = `正在更新 Benchmark 為 ${newBenchmark}...`;
        loadingOverlay.style.display = 'flex';
        try {
            // 步驟 1: 直接呼叫基礎 apiRequest
            await apiRequest('update_benchmark', { benchmarkSymbol: newBenchmark });
            
            // 步驟 2: 成功後，呼叫 fetchAllCoreData 來刷新整個應用
            await fetchAllCoreData(false); // false 表示不重複顯示 loading
            
            showNotification('success', 'Benchmark 已成功更新！');
        } catch (error) {
            showNotification('error', `操作失敗: ${error.message}`);
        } finally {
            loadingOverlay.style.display = 'none';
            loadingText.textContent = '正在從雲端同步資料...';
        }
    };

    if (stagedActions.length > 0) {
        const { showConfirm, hideConfirm } = await import('../ui/modals.js');
        showConfirm(
            '您有未提交的變更。更新 Benchmark 前，必須先提交所有暫存的變更。要繼續嗎？',
            async () => {
                hideConfirm();
                loadingText.textContent = '正在提交暫存區...';
                loadingOverlay.style.display = 'flex';
                try {
                    const netActions = await stagingService.getNetActions();
                    const submitResult = await submitBatch(netActions);
                    if (submitResult.success) {
                        await stagingService.clearActions();
                        await performUpdate(); // 提交成功後，執行更新 Benchmark
                    }
                } catch (error) {
                    // submitBatch 內部已有錯誤提示，此處只需確保 loading 畫面關閉
                    loadingOverlay.style.display = 'none';
                    loadingText.textContent = '正在從雲端同步資料...';
                }
            },
            '提交並更新 Benchmark？',
            () => { 
                hideConfirm();
            }
        );
    } else {
        await performUpdate();
    }
}
// ========================= 【核心修改 - 結束】 =========================


function handleChartRangeChange(chartType, rangeType, startDate = null, endDate = null) {
    const stateKey = chartType === 'twr' ? 'twrDateRange'
        : chartType === 'asset' ? 'assetDateRange'
            : 'netProfitDateRange';
    const historyKey = chartType === 'twr' ? 'twrHistory'
        : chartType === 'asset' ? 'portfolioHistory'
            : 'netProfitHistory';
    const controlsId = chartType === 'twr' ? 'twr-chart-controls'
        : chartType === 'asset' ? 'asset-chart-controls'
            : 'net-profit-chart-controls';

    const finalStateKey = chartType === 'net-profit' ? 'netProfitDateRange' : stateKey;
    const finalHistoryKey = chartType === 'net-profit' ? 'netProfitHistory' : historyKey;

    const newRange = { type: rangeType, start: startDate, end: endDate };
    setState({ [finalStateKey]: newRange });

    document.querySelectorAll(`#${controlsId} .chart-range-btn`).forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.range === rangeType) btn.classList.add('active');
    });

    const fullHistory = getState()[finalHistoryKey];
    const { startDate: finalStartDate, endDate: finalEndDate } = getDateRangeForPreset(fullHistory, newRange);

    if (rangeType !== 'custom') {
        const startDateInput = document.getElementById(`${chartType}-start-date`);
        const endDateInput = document.getElementById(`${chartType}-end-date`);
        if (startDateInput && endDateInput) {
            startDateInput.value = finalStartDate;
            endDateInput.value = finalEndDate;
        }
    }

    if (chartType === 'twr') {
        const benchmarkSymbol = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim() || 'SPY';
        updateTwrChart(benchmarkSymbol);
    } else if (chartType === 'asset') {
        updateAssetChart();
    } else if (chartType === 'net-profit') {
        updateNetProfitChart();
    }
}

// --- Public Function ---

export function initializeGeneralEventListeners() {
    document.getElementById('update-benchmark-btn').addEventListener('click', handleUpdateBenchmark);
    
    document.getElementById('holdings-content').addEventListener('click', (e) => {
        const { holdings, activeMobileHolding } = getState();

        const viewSwitchBtn = e.target.closest('#holdings-view-switcher button');
        if (viewSwitchBtn) {
            const newView = viewSwitchBtn.dataset.view;
            setState({ mobileViewMode: newView, activeMobileHolding: null });
            renderHoldingsTable(holdings);
            return;
        }

        const listItem = e.target.closest('.list-view-item');
        if (listItem) {
            const symbol = listItem.dataset.symbol;
            const newActiveHolding = activeMobileHolding === symbol ? null : symbol;
            setState({ activeMobileHolding: newActiveHolding });
            renderHoldingsTable(holdings);
            return;
        }
        
        const mobileDetailsBtn = e.target.closest('.open-details-btn');
        if (mobileDetailsBtn) {
             handleShowDetails(mobileDetailsBtn.dataset.symbol);
             return;
        }

        const sortHeader = e.target.closest('[data-sort-key]');
        if (sortHeader) {
            const newSortKey = sortHeader.dataset.sortKey;
            const { holdingsSort } = getState();
            let newOrder = 'desc';
            if (holdingsSort.key === newSortKey && holdingsSort.order === 'desc') {
                newOrder = 'asc';
            }
            setState({ holdingsSort: { key: newSortKey, order: newOrder } });
            renderHoldingsTable(holdings);
            return;
        }
        
        const holdingRow = e.target.closest('.holding-row');
        if (holdingRow) {
            handleShowDetails(holdingRow.dataset.symbol);
            return;
        }
    });
    
    document.getElementById('details-modal').addEventListener('click', async (e) => {
        if (e.target.closest('#close-details-modal-btn')) {
            const { closeModal } = await import('../ui/modals.js');
            closeModal('details-modal');
            return;
        }
        const tabItem = e.target.closest('.details-tab-item');
        if (tabItem) {
            e.preventDefault();
            const symbol = document.querySelector('#details-modal-content h2').textContent;
            await switchDetailsTab(tabItem.dataset.tab, symbol);
            return;
        }
        
        const editBtn = e.target.closest('.details-edit-tx-btn');
        if (editBtn) {
            const txId = editBtn.dataset.id;
            const combinedTransactions = await selectCombinedTransactions();
            const txToEdit = combinedTransactions.find(t => t.id === txId);

            if (txToEdit) {
                const { closeModal, openModal } = await import('../ui/modals.js');
                closeModal('details-modal');
                await openModal('transaction-modal', true, txToEdit);
            }
            return;
        }

        const deleteBtn = e.target.closest('.details-delete-tx-btn');
        if (deleteBtn) {
            const txId = deleteBtn.dataset.id;
            const { showConfirm } = await import('../ui/modals.js');
            
            const combinedTransactions = await selectCombinedTransactions();
            const txToDelete = combinedTransactions.find(t => t.id === txId);

            if (!txToDelete) {
                showNotification('error', '找不到要刪除的交易紀錄。');
                return;
            }

            showConfirm('確定要刪除這筆交易紀錄嗎？', async () => {
                try {
                    await stagingService.addAction('DELETE', 'transaction', txToDelete);
                    showNotification('info', '刪除操作已暫存。');
                    
                    const symbol = document.querySelector('#details-modal-content h2').textContent;
                    await switchDetailsTab('transactions', symbol);

                } catch (err) {
                    console.error("暫存刪除交易失敗:", err);
                    showNotification('error', '暫存刪除操作時發生錯誤。');
                }
            });
            return;
        }
    });

    const twrControls = document.getElementById('twr-chart-controls');
    if (twrControls) {
        twrControls.addEventListener('click', (e) => {
            const btn = e.target.closest('.chart-range-btn');
            if (btn) handleChartRangeChange('twr', btn.dataset.range);
        });
        twrControls.addEventListener('change', (e) => {
            if (e.target.matches('.chart-date-input')) {
                const startInput = twrControls.querySelector('#twr-start-date');
                const endInput = twrControls.querySelector('#twr-end-date');
                if (startInput && endInput && startInput.value && endInput.value) {
                    twrControls.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                    handleChartRangeChange('twr', 'custom', startInput.value, endInput.value);
                }
            }
        });
    }

    const assetControls = document.getElementById('asset-chart-controls');
    if (assetControls) {
        assetControls.addEventListener('click', (e) => {
            const btn = e.target.closest('.chart-range-btn');
            if (btn) handleChartRangeChange('asset', btn.dataset.range);
        });
        assetControls.addEventListener('change', (e) => {
            if (e.target.matches('.chart-date-input')) {
                const startInput = assetControls.querySelector('#asset-start-date');
                const endInput = assetControls.querySelector('#asset-end-date');
                if (startInput && endInput && startInput.value && endInput.value) {
                    assetControls.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                    handleChartRangeChange('asset', 'custom', startInput.value, endInput.value);
                }
            }
        });
    }
    
    const netProfitControls = document.getElementById('net-profit-chart-controls');
    if (netProfitControls) {
        netProfitControls.addEventListener('click', (e) => {
            const btn = e.target.closest('.chart-range-btn');
            if (btn) handleChartRangeChange('net-profit', btn.dataset.range);
        });
        netProfitControls.addEventListener('change', (e) => {
            if (e.target.matches('.chart-date-input')) {
                const startInput = netProfitControls.querySelector('#net-profit-start-date');
                const endInput = netProfitControls.querySelector('#net-profit-end-date');
                if (startInput && endInput && startInput.value && endInput.value) {
                    netProfitControls.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                    handleChartRangeChange('net-profit', 'custom', startInput.value, endInput.value);
                }
            }
        });
    }
}
