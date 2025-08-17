// =========================================================================================
// == 通用事件處理模組 (general.events.js) v3.0 - 支援持股詳情彈窗
// =========================================================================================

import { getState, setState } from '../state.js';
import { executeApiAction } from '../api.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { openModal, closeModal } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { getDateRangeForPreset } from '../ui/utils.js';
import { updateAssetChart } from '../ui/charts/assetChart.js';
import { updateTwrChart } from '../ui/charts/twrChart.js';
import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';
// 【新增】導入詳情彈窗的分頁切換函式
import { switchDetailsTab } from '../ui/components/detailsModal.ui.js';

// --- Private Functions ---

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

// 【修改】將儲存筆記的邏輯抽成可重用函式
async function saveNoteAction(noteData, modalToClose = 'notes-modal') {
    closeModal(modalToClose);

    executeApiAction('save_stock_note', noteData, {
        loadingText: `正在儲存 ${noteData.symbol} 的筆記...`,
        successMessage: `${noteData.symbol} 的筆記已儲存！`,
        shouldRefreshData: false
    }).then(() => {
        const { holdings, stockNotes } = getState();
        stockNotes[noteData.symbol] = { ...stockNotes[noteData.symbol], ...noteData };
        setState({ stockNotes });
        renderHoldingsTable(holdings); // 重新渲染持股列表以更新目標價提示
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
    document.getElementById('cancel-notes-btn').addEventListener('click', () => closeModal('notes-modal'));

    // 監聽持股內容區的點擊
    document.getElementById('holdings-content').addEventListener('click', (e) => {
        const { holdings, activeMobileHolding } = getState();

        // 優先處理最精確的點擊目標 (按鈕)，以避免觸發整列的點擊事件
        const notesBtn = e.target.closest('.open-notes-btn');
        if (notesBtn) {
            openModal('notes-modal', false, { symbol: notesBtn.dataset.symbol });
            return;
        }

        // 處理行動裝置視圖切換
        const viewSwitchBtn = e.target.closest('#holdings-view-switcher button');
        if (viewSwitchBtn) {
            const newView = viewSwitchBtn.dataset.view;
            setState({ mobileViewMode: newView, activeMobileHolding: null });
            renderHoldingsTable(holdings);
            return;
        }

        // 處理行動裝置列表模式的展開/收合
        const listItem = e.target.closest('.list-view-item');
        if (listItem) {
            const symbol = listItem.dataset.symbol;
            const newActiveHolding = activeMobileHolding === symbol ? null : symbol;
            setState({ activeMobileHolding: newActiveHolding });
            renderHoldingsTable(holdings);
            return;
        }
        
        // 處理行動裝置卡片上的「更多詳情」按鈕
        const mobileDetailsBtn = e.target.closest('.open-details-btn');
        if (mobileDetailsBtn) {
             openModal('details-modal', false, { symbol: mobileDetailsBtn.dataset.symbol });
             return;
        }

        // 處理桌面版排序
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

        // 【新增】處理桌面版整列點擊以開啟詳情
        const holdingRow = e.target.closest('.holding-row');
        if (holdingRow) {
            openModal('details-modal', false, { symbol: holdingRow.dataset.symbol });
            return;
        }
    });
    
    // 【新增】監聽詳情彈窗內部的所有互動
    document.getElementById('details-modal').addEventListener('click', (e) => {
        // 關閉按鈕
        if (e.target.closest('#close-details-modal-btn')) {
            closeModal('details-modal');
            return;
        }
        // 分頁切換
        const tabItem = e.target.closest('.details-tab-item');
        if (tabItem) {
            e.preventDefault();
            const symbol = document.getElementById('details-notes-symbol')?.value || document.querySelector('#details-modal-content h2').textContent;
            switchDetailsTab(tabItem.dataset.tab, symbol);
            return;
        }
    });

    // 【新增】單獨監聽詳情彈窗中筆記表單的提交事件
    document.addEventListener('submit', (e) => {
        if (e.target.id === 'details-notes-form') {
            e.preventDefault();
            const noteData = {
                symbol: document.getElementById('details-notes-symbol').value,
                target_price: parseFloat(document.getElementById('details-target-price').value) || null,
                stop_loss_price: parseFloat(document.getElementById('details-stop-loss-price').value) || null,
                notes: document.getElementById('details-notes-content').value.trim()
            };
            // 提交後，關閉的是詳情彈窗
            saveNoteAction(noteData, 'details-modal');
        }
    });

    // 監聽所有圖表控制項 (以下不變)
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
