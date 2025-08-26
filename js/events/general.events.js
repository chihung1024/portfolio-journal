// =========================================================================================
// == 通用事件處理模組 (general.events.js) v4.2 - Final Architecture Consistency Fix
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { showNotification } from '../ui/notifications.js';
import { getDateRangeForPreset } from '../ui/utils.js';
import { updateAssetChart } from '../ui/charts/assetChart.js';
import { updateTwrChart } from '../ui/charts/twrChart.js';
import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';
import { switchDetailsTab } from '../ui/components/detailsModal.ui.js';
import { refreshAllStagedViews } from '../main.js';

// --- Private Functions ---

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【重構】顯示股票詳情彈出視窗。
 * 移除後端 API 呼叫，改為直接使用前端 state 中已存在的、包含暫存狀態的完整資料，
 * 以確保資料的絕對一致性。
 */
async function handleShowDetails(symbol) {
    const { transactions } = getState();
    // 檢查本地 state 中是否已有此股票的交易資料
    const hasDataLocally = transactions.some(t => t.symbol.toUpperCase() === symbol.toUpperCase());

    if (hasDataLocally) {
        // 如果資料已存在，直接開啟彈出視窗
        const { openModal } = await import('../ui/modals.js');
        openModal('details-modal', false, { symbol });
    } else {
        // 如果本地 state 沒有資料（理論上在新架構下不應發生，但作為防錯機制保留），
        // 提示使用者這是一個異常情況。
        showNotification('error', `無法在本地找到 ${symbol} 的詳細資料，請嘗試刷新頁面。`);
        console.warn(`Attempted to open details for ${symbol}, but no transactions were found in the local state.`);
    }
}
// ========================= 【核心修改 - 結束】 =========================


/**
 * 處理更新 Benchmark，將其導向暫存區
 */
async function handleUpdateBenchmark() {
    const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
    if (!newBenchmark) {
        showNotification('error', '請輸入 Benchmark 的股票代碼。');
        return;
    }

    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`Benchmark 的變更將進入暫存區，點擊「全部提交」後才會生效。確定要更新嗎？`, async () => {
        const change = {
            op: 'UPDATE', 
            entity: 'benchmark',
            payload: { benchmarkSymbol: newBenchmark }
        };

        try {
            await apiRequest('stage_change', change);
            showNotification('info', `更新 Benchmark 的操作已加入暫存區。`);
            await refreshAllStagedViews();
        } catch (error) {
            showNotification('error', `更新 Benchmark 失敗: ${error.message}`);
        }
    });
}

/**
 * 處理儲存筆記，將其導向暫存區
 */
async function saveNoteAction(noteData, modalToClose = 'notes-modal') {
    const { closeModal } = await import('../ui/modals.js');
    closeModal(modalToClose);

    const change = {
        op: 'UPDATE', 
        entity: 'note',
        payload: noteData
    };
    
    try {
        await apiRequest('stage_change', change);
        showNotification('info', `儲存 ${noteData.symbol} 筆記的操作已加入暫存區。`);
        
        const { stockNotes } = getState();
        stockNotes[noteData.symbol] = { ...stockNotes[noteData.symbol], ...noteData, status: 'STAGED_UPDATE' };
        setState({ stockNotes, hasStagedChanges: true });
        
        const { holdings } = getState();
        renderHoldingsTable(holdings);
        const { updateStagingBanner } = await import('../ui/components/stagingBanner.ui.js');
        updateStagingBanner();

    } catch (error) {
        showNotification('error', `儲存筆記失敗: ${error.message}`);
    }
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

    document.getElementById('notes-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            document.getElementById('save-notes-btn').click();
        }
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
    });

    document.addEventListener('submit', (e) => {
        if (e.target.id === 'details-notes-form') {
            e.preventDefault();
            const noteData = {
                symbol: document.getElementById('details-notes-symbol').value,
                target_price: parseFloat(document.getElementById('details-target-price').value) || null,
                stop_loss_price: parseFloat(document.getElementById('details-stop-loss-price').value) || null,
                notes: document.getElementById('details-notes-content').value.trim()
            };
             saveNoteAction(noteData);
        }
    });

    document.getElementById('details-modal').addEventListener('keydown', (e) => {
        if (e.target.closest('#details-notes-form') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            document.getElementById('details-save-notes-btn').click();
        }
    });

    const chartControls = ['twr', 'asset', 'net-profit'];
    chartControls.forEach(chartType => {
        const controls = document.getElementById(`${chartType}-chart-controls`);
        if (controls) {
            controls.addEventListener('click', (e) => {
                const btn = e.target.closest('.chart-range-btn');
                if (btn) handleChartRangeChange(chartType, btn.dataset.range);
            });
            controls.addEventListener('change', (e) => {
                if (e.target.matches('.chart-date-input')) {
                    const startInput = controls.querySelector(`#${chartType}-start-date`);
                    const endInput = controls.querySelector(`#${chartType}-end-date`);
                    if (startInput && endInput && startInput.value && endInput.value) {
                        controls.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                        handleChartRangeChange(chartType, 'custom', startInput.value, endInput.value);
                    }
                }
            });
        }
    });
}