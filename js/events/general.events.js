// =========================================================================================
// == 通用事件處理模組 (general.events.js) v3.3 - (修正) 補全詳情彈窗的還原事件
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, executeApiAction } from '../api.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { showNotification } from '../ui/notifications.js';
import { getDateRangeForPreset } from '../ui/utils.js';
import { updateAssetChart } from '../ui/charts/assetChart.js';
import { updateTwrChart } from '../ui/charts/twrChart.js';
import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';
import { switchDetailsTab, renderDetailsModal } from '../ui/components/detailsModal.ui.js';
// 【新增】導入還原函式
import { handleRevertChange } from './transaction.events.js';

// --- Private Functions ---

async function handleShowDetails(symbol) {
    const { transactions } = getState();
    const hasDataLocally = transactions.some(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    const { openModal } = await import('../ui/modals.js');
    if (hasDataLocally) {
        openModal('details-modal', false, { symbol });
    } else {
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        loadingText.textContent = `正在讀取 ${symbol} 的詳細資料...`;
        loadingOverlay.style.display = 'flex';
        try {
            const result = await apiRequest('get_symbol_details', { symbol });
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
                openModal('details-modal', false, { symbol });
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

async function handleUpdateBenchmark() {
    const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
    if (!newBenchmark) {
        showNotification('error', '請輸入 Benchmark 的股票代碼。');
        return;
    }
    executeApiAction('update_benchmark', { benchmarkSymbol: newBenchmark }, {
        loadingText: `正在更新 Benchmark 為 ${newBenchmark}...`,
        successMessage: 'Benchmark 已成功更新！'
    }).catch(error => {
        console.error("更新 Benchmark 最終失敗:", error);
    });
}

async function saveNoteAction(noteData, modalToClose = 'notes-modal') {
    const { closeModal } = await import('../ui/modals.js');
    closeModal(modalToClose);
    executeApiAction('save_stock_note', noteData, {
        loadingText: `正在儲存 ${noteData.symbol} 的筆記...`,
        successMessage: `${noteData.symbol} 的筆記已儲存！`,
        shouldRefreshData: false
    }).then(() => {
        const { holdings, stockNotes } = getState();
        stockNotes[noteData.symbol] = { ...stockNotes[noteData.symbol], ...noteData };
        setState({ stockNotes });
        renderHoldingsTable(holdings); 
    }).catch(error => {
        console.error("儲存筆記最終失敗:", error);
    });
}

async function handleNotesFormSubmit(e) {
    e.preventDefault();
    const noteData = {
        symbol: document.getElementById('notes-symbol').value,
        target_price: parseFloat(document.getElementById('target-price').value) || null,
        stop_loss_price: parseFloat(document.getElementById('stop-loss-price').value) || null,
        notes: document.getElementById('notes-content').value.trim()
    };
    saveNoteAction(noteData, 'notes-modal');
}

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
    document.getElementById('notes-form').addEventListener('submit', handleNotesFormSubmit);
    document.getElementById('cancel-notes-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('notes-modal');
    });

    document.getElementById('holdings-content').addEventListener('click', (e) => {
        const { holdings, activeMobileHolding } = getState();
        const notesBtn = e.target.closest('.open-notes-btn');
        if (notesBtn) {
            (async () => {
                const { openModal } = await import('../ui/modals.js');
                openModal('notes-modal', false, { symbol: notesBtn.dataset.symbol });
            })();
            return;
        }
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
    
    // ========================= 【核心修改 - 開始】 =========================
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
            switchDetailsTab(tabItem.dataset.tab, symbol);
            return;
        }
        const editBtn = e.target.closest('.details-edit-tx-btn');
        if (editBtn) {
            const txId = editBtn.dataset.id;
            const { transactions } = getState();
            const txToEdit = transactions.find(t => t.id === txId);
            if (txToEdit) {
                const { closeModal, openModal } = await import('../ui/modals.js');
                closeModal('details-modal');
                openModal('transaction-modal', true, txToEdit);
            }
            return;
        }
        const deleteBtn = e.target.closest('.details-delete-tx-btn');
        if (deleteBtn) {
            // 這裡的刪除也需要遵循樂觀更新，但邏輯已在 transaction.events.js 中，此處僅需觸發
            // 我們可以模擬一個點擊事件，或者直接調用刪除函式
            const txId = deleteBtn.dataset.id;
            const { showConfirm } = await import('../ui/modals.js');
            const { handleDelete } = await import('./transaction.events.js'); // 動態導入
            // 由於 handleDelete 內部有自己的 showConfirm，這裡直接調用即可
            // 為了讓 handleDelete 能找到按鈕，我們需要創建一個臨時按鈕
            const tempBtn = document.createElement('button');
            tempBtn.dataset.id = txId;
            // 這裡直接調用會很奇怪，我們應該重構 handleDelete
            // 暫時使用 executeApiAction 來保持一致
            showConfirm('確定要刪除這筆交易紀錄嗎？', () => {
                 // 注意：這個刪除將是舊的同步模式，但可以解決暫時問題
                 // 正確的做法是將 handleDelete 重構成可重用函式
                 executeApiAction('delete_transaction', { txId }, {
                    loadingText: '正在刪除交易...',
                    successMessage: '交易已成功刪除！'
                }).then(() => {
                    const symbol = document.querySelector('#details-modal-content h2').textContent;
                    setTimeout(() => renderDetailsModal(symbol), 200);
                }).catch(err => console.error("刪除交易失敗:", err));
            });
            return;
        }
        
        // 【新增】處理還原按鈕的點擊事件
        const revertButton = e.target.closest('.revert-change-btn');
        if (revertButton) {
            e.preventDefault();
            const symbol = document.querySelector('#details-modal-content h2').textContent;

            // 呼叫從 transaction.events.js 導入的函式
            await handleRevertChange(revertButton);
            
            // 還原成功後，handleRevertChange 會更新全局 state
            // 我們只需要用新的 state 重新渲染當前的彈窗即可
            renderDetailsModal(symbol);
            switchDetailsTab('transactions', symbol);
            return;
        }
    });
    // ========================= 【核心修改 - 結束】 =========================

    document.addEventListener('submit', (e) => {
        if (e.target.id === 'details-notes-form') {
            e.preventDefault();
            const noteData = {
                symbol: document.getElementById('details-notes-symbol').value,
                target_price: parseFloat(document.getElementById('details-target-price').value) || null,
                stop_loss_price: parseFloat(document.getElementById('details-stop-loss-price').value) || null,
                notes: document.getElementById('details-notes-content').value.trim()
            };
             executeApiAction('save_stock_note', noteData, {
                loadingText: `正在儲存 ${noteData.symbol} 的筆記...`,
                successMessage: `${noteData.symbol} 的筆記已儲存！`,
                shouldRefreshData: false
            }).then(() => {
                const { holdings, stockNotes } = getState();
                stockNotes[noteData.symbol] = { ...stockNotes[noteData.symbol], ...noteData };
                setState({ stockNotes });
                renderHoldingsTable(holdings);
                renderDetailsModal(noteData.symbol);
                switchDetailsTab('notes', noteData.symbol);
            }).catch(error => {
                console.error("儲存筆記最終失敗:", error);
            });
        }
    });

    // Chart controls listeners
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
