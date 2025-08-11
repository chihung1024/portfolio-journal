// =========================================================================================
// == 主程式進入點 (main.js) v3.7.2 - Refactoring Events
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, loadPortfolioData } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';

// --- UI Module Imports ---
import { getDateRangeForPreset } from './ui/utils.js';
import { initializeAssetChart, updateAssetChart } from './ui/charts/assetChart.js';
import { initializeTwrChart, updateTwrChart } from './ui/charts/twrChart.js';
import { initializeNetProfitChart, updateNetProfitChart } from './ui/charts/netProfitChart.js';
import { renderHoldingsTable } from './ui/components/holdings.ui.js';
import { renderDividendsManagementTab } from './ui/components/dividends.ui.js';
import { openModal, closeModal, showConfirm, hideConfirm, toggleOptionalFields } from './ui/modals.js';
import { showNotification } from './ui/notifications.js';
import { switchTab } from './ui/tabs.js';

// --- Event Module Imports ---
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';


// --- 事件處理函式 ---
// 【移除】handleBulkConfirm, handleDividendFormSubmit, handleDeleteDividend

async function handleUpdateBenchmark() {
    const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
    if (!newBenchmark) { showNotification('error', '請輸入 Benchmark 的股票代碼。'); return; }
    try {
        document.getElementById('loading-overlay').style.display = 'flex';
        await apiRequest('update_benchmark', { benchmarkSymbol: newBenchmark });
        await loadPortfolioData();
    } catch(error) {
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

// 註：此函式由通用的 switchTab 邏輯呼叫，因此保留在 main.js 中
export async function loadAndShowDividends() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';
    try {
        const result = await apiRequest('get_dividends_for_management', {});
        if (result.success) {
            setState({
                pendingDividends: result.data.pendingDividends,
                confirmedDividends: result.data.confirmedDividends,
            });
            renderDividendsManagementTab(result.data.pendingDividends, result.data.confirmedDividends);
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        showNotification('error', `讀取配息資料失敗: ${error.message}`);
    } finally {
        overlay.style.display = 'none';
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

function setupCommonEventListeners() {
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirm);
    document.getElementById('confirm-ok-btn').addEventListener('click', () => { 
        const { confirmCallback } = getState();
        if (confirmCallback) { confirmCallback(); } 
        hideConfirm(); 
    });
}

function setupMainAppEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    
    document.getElementById('update-benchmark-btn').addEventListener('click', handleUpdateBenchmark);
    document.getElementById('notes-form').addEventListener('submit', handleNotesFormSubmit);
    document.getElementById('cancel-notes-btn').addEventListener('click', () => closeModal('notes-modal'));
    
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

    document.getElementById('tabs').addEventListener('click', (e) => {
        const { renderTransactionsTable } = require("./ui/components/transactions.ui.js");
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            e.preventDefault();
            const tabName = tabItem.dataset.tab;
            switchTab(tabName);
            if (tabName === 'dividends') {
                loadAndShowDividends();
            } else if (tabName === 'transactions') {
                renderTransactionsTable();
            }
        }
    });

    // 【移除】配息相關的事件監聽
    
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);

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

export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");
    initializeAssetChart();
    initializeTwrChart();
    initializeNetProfitChart();
    
    setTimeout(() => {
        setupMainAppEventListeners();
        initializeTransactionEventListeners();
        initializeSplitEventListeners();
        initializeDividendEventListeners();
        lucide.createIcons();
    }, 0);

    setState({ isAppInitialized: true });
}

document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
