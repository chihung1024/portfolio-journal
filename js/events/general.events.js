// =========================================================================================
// == 通用事件處理模組 (general.events.js)
// == 職責：處理筆記、Benchmark、圖表控制等通用或零散的用戶互動事件。
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest, loadPortfolioData } from '../api.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
// 【修正前】: import { openModal, closeModal, showNotification } from '../ui/modals.js';
// 【修正後】: 分開從各自的模組引入
import { openModal, closeModal } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { getDateRangeForPreset } from '../ui/utils.js';
import { updateAssetChart } from '../ui/charts/assetChart.js';
import { updateTwrChart } from '../ui/charts/twrChart.js';
import { updateNetProfitChart } from '../ui/charts/netProfitChart.js';

// --- Private Functions ---

async function handleUpdateBenchmark() {
    const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
    if (!newBenchmark) {
        showNotification('error', '請輸入 Benchmark 的股票代碼。');
        return;
    }
    try {
        document.getElementById('loading-overlay').style.display = 'flex';
        await apiRequest('update_benchmark', { benchmarkSymbol: newBenchmark });
        await loadPortfolioData();
    } catch (error) {
        showNotification('error', `更新 Benchmark 失敗: ${error.message}`);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }
}

async function handleNotesFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('save-notes-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';
    const noteData = {
        symbol: document.getElementById('notes-symbol').value,
        target_price: parseFloat(document.getElementById('target-price').value) || null,
        stop_loss_price: parseFloat(document.getElementById('stop-loss-price').value) || null,
        notes: document.getElementById('notes-content').value.trim()
    };
    try {
        await apiRequest('save_stock_note', noteData);
        closeModal('notes-modal');
        const { holdings, stockNotes } = getState();
        stockNotes[noteData.symbol] = { ...stockNotes[noteData.symbol], ...noteData };
        setState({ stockNotes });
        renderHoldingsTable(holdings);
        showNotification('success', `${noteData.symbol} 的筆記已儲存！`);
    } catch (error) {
        showNotification('error', `儲存筆記失敗: ${error.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存筆記';
    }
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

    // 監聽持股內容區的點擊（用於排序和開啟筆記）
    document.getElementById('holdings-content').addEventListener('click', (e) => {
        const sortHeader = e.target.closest('[data-sort-key]');
        if (sortHeader) {
            const newSortKey = sortHeader.dataset.sortKey;
            const { holdingsSort, holdings } = getState();
            let newOrder = 'desc';
            if (holdingsSort.key === newSortKey && holdingsSort.order === 'desc') {
                newOrder = 'asc';
            }
            setState({ holdingsSort: { key: newSortKey, order: newOrder } });
            renderHoldingsTable(holdings);
            return;
        }
        const notesBtn = e.target.closest('.open-notes-btn');
        if (notesBtn) {
            openModal('notes-modal', false, { symbol: notesBtn.dataset.symbol });
            return;
        }
    });
    
    // 監聽所有圖表控制項
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
