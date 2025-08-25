// =========================================================================================
// == 通用事件處理模組 (general.events.js) v3.5 - Staging-Ready
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
import { loadInitialDashboard, refreshAllStagedViews } from '../app.js';

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
                setState({ transactions: [...currentState.transactions, ...uniqueNewTxs], confirmedDividends: [...currentState.confirmedDividends, ...uniqueNewDivs] });
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
    try {
        await executeApiAction('update_benchmark', { benchmarkSymbol: newBenchmark }, {
            loadingText: `正在更新 Benchmark 為 ${newBenchmark}...`,
            successMessage: 'Benchmark 已成功更新！'
        });
        await loadInitialDashboard();
    } catch (error) {
        console.error("更新 Benchmark 最終失敗:", error);
    }
}

// ========================= 【核心修改 - 開始】 =========================
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
        showNotification('info', `筆記變更已加入暫存區。`);
        await refreshAllStagedViews();
    } catch (error) {
        showNotification('error', `儲存筆記失敗: ${error.message}`);
    }
}
// ========================= 【核心修改 - 結束】 =========================

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
    // ... Omitted for brevity
}

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
        // ... other event handlers omitted for brevity
    });
    
    document.getElementById('details-modal').addEventListener('click', async (e) => {
        const { closeModal } = await import('../ui/modals.js');
        if (e.target.closest('#close-details-modal-btn')) {
            closeModal('details-modal');
            return;
        }
        // ... other event handlers omitted for brevity
        const deleteBtn = e.target.closest('.details-delete-tx-btn');
        if (deleteBtn) {
            const txId = deleteBtn.dataset.id;
            const { showConfirm } = await import('../ui/modals.js');
            showConfirm('您確定要刪除這筆交易紀錄嗎？此為舊版刪除功能，將直接生效並重算績效。', async () => {
                closeModal('details-modal');
                try {
                    await executeApiAction('delete_transaction', { txId }, {
                        loadingText: '正在刪除交易並重算績效...',
                        successMessage: '交易已成功刪除！'
                    });
                    await loadInitialDashboard();
                } catch (err) {
                    console.error("刪除交易失敗:", err);
                }
            });
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
            saveNoteAction(noteData, 'details-modal');
        }
    });

    document.getElementById('details-modal').addEventListener('keydown', (e) => {
        if (e.target.closest('#details-notes-form') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            document.getElementById('details-save-notes-btn').click();
        }
    });

    // Chart controls listeners
    // ... Omitted for brevity
}
