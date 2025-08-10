// =========================================================================================
// == 主程式進入點 (main.js) v3.7.0 - 實作群組管理與篩選功能
// =========================================================================================

import { getState, setState } from './state.js';
import { apiRequest, loadPortfolioData, loadGroups, saveGroup, deleteGroup, calculateBySymbols } from './api.js';
import { initializeAuth, handleRegister, handleLogin, handleLogout } from './auth.js';
import { 
    initializeChart, 
    initializeTwrChart, 
    initializeNetProfitChart,
    openModal, 
    closeModal, 
    showConfirm, 
    hideConfirm, 
    toggleOptionalFields, 
    showNotification,
    switchTab,
    renderHoldingsTable,
    renderTransactionsTable,
    renderDividendsManagementTab,
    updateUIWithData,
    renderGroupFilter,
    renderGroupManagementModal,
    updateDividendsTabIndicator,
    getDateRangeForPreset,
} from './ui.js';

// --- 事件處理函式 ---

async function requestDataSync() {
    const { isGroupView, selectedGroupId, groups, fullPortfolioData } = getState();
    if (getState().isSyncing) {
        console.log("數據同步中，已忽略本次請求。");
        return;
    }
    try {
        setState({ isSyncing: true });
        // 如果正在群組檢視中，刷新應重新計算該群組；否則刷新全部
        if (isGroupView && selectedGroupId !== '_all_') {
            const selectedGroup = groups.find(g => g.id === selectedGroupId);
            if (selectedGroup) {
                const symbols = JSON.parse(selectedGroup.symbols_json);
                const filteredData = await calculateBySymbols(symbols);
                updateUIWithData(filteredData);
            }
        } else {
            await loadPortfolioData();
        }
    } catch (error) {
        console.error("請求同步時發生錯誤:", error);
    } finally {
        setState({ isSyncing: false });
    }
}


function handleEdit(button) {
    const txId = button.dataset.id;
    openModal('transaction-modal', true, { id: txId });
}

async function handleDelete(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    
    showConfirm('確定要刪除這筆交易紀錄嗎？', () => {
        const originalTransactions = [...transactions];
        const updatedTransactions = transactions.filter(t => t.id !== txId);
        setState({ transactions: updatedTransactions });

        renderTransactionsTable();
        showNotification('info', '交易已於介面移除，正在同步至雲端...');

        apiRequest('delete_transaction', { txId })
            .then(result => {
                showNotification('success', '交易紀錄已成功從雲端刪除！');
                requestDataSync();
            })
            .catch(error => {
                showNotification('error', `刪除失敗: ${error.message}`);
                setState({ transactions: originalTransactions });
                renderTransactionsTable();
            });
    });
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    const txId = document.getElementById('transaction-id').value;
    const isEditing = !!txId;

    const transactionData = {
        date: document.getElementById('transaction-date').value,
        symbol: document.getElementById('stock-symbol').value.toUpperCase().trim(),
        type: document.querySelector('input[name="transaction-type"]:checked').value,
        quantity: parseFloat(document.getElementById('quantity').value),
        price: parseFloat(document.getElementById('price').value),
        currency: document.getElementById('currency').value,
        totalCost: parseFloat(document.getElementById('total-cost').value) || null,
        exchangeRate: parseFloat(document.getElementById('exchange-rate').value) || null,
        group_tag: document.getElementById('group-tag').value.trim() || null
    };

    if (!transactionData.symbol || isNaN(transactionData.quantity) || isNaN(transactionData.price)) {
        showNotification('error', '請填寫所有必填欄位。');
        return;
    }
    
    closeModal('transaction-modal');
    showNotification('info', '交易已更新於介面，正在同步至雲端...');

    const action = isEditing ? 'edit_transaction' : 'add_transaction';
    const payload = isEditing ? { txId, txData: transactionData } : transactionData;

    apiRequest(action, payload)
        .then(result => {
            showNotification('success', isEditing ? '交易已成功更新！' : '交易已成功新增！');
            requestDataSync();
        })
        .catch(error => {
            showNotification('error', `儲存交易失敗: ${error.message}`);
            loadPortfolioData(); // 失敗時觸發完整刷新以恢復正確狀態
        });
}

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    showConfirm('確定要刪除這個拆股事件嗎？', async () => {
        try {
            await apiRequest('delete_split', { splitId });
            showNotification('success', '拆股事件已刪除！');
            await requestDataSync();
        } catch (error) {
            showNotification('error', `刪除失敗: ${error.message}`);
        }
    });
}

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const splitData = { date: document.getElementById('split-date').value, symbol: document.getElementById('split-symbol').value.toUpperCase().trim(), ratio: parseFloat(document.getElementById('split-ratio').value) };
    if (!splitData.symbol || isNaN(splitData.ratio) || splitData.ratio <= 0) {
        showNotification('error', '請填寫所有欄位並確保比例大於0。');
        return;
    }
    try {
        await apiRequest('add_split', splitData);
        closeModal('split-modal');
        showNotification('success', '拆股事件已新增！');
        await requestDataSync();
    } catch (error) {
        showNotification('error', `新增拆股事件失敗: ${error.message}`);
    }
}

async function handleUpdateBenchmark() {
    const newBenchmark = document.getElementById('benchmark-symbol-input').value.toUpperCase().trim();
    if (!newBenchmark) { showNotification('error', '請輸入 Benchmark 的股票代碼。'); return; }
    try {
        await apiRequest('update_benchmark', { benchmarkSymbol: newBenchmark });
        showNotification('success', '基準已更新！');
        await requestDataSync();
    } catch(error) {
        showNotification('error', `更新 Benchmark 失敗: ${error.message}`);
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
    }
}

async function loadAndShowDividends() {
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
    }
}

async function handleBulkConfirm() {
    const { pendingDividends, confirmedDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }

    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？系統將套用預設值。`, () => {
        const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;

        const newConfirmedDividends = pendingDividends.map(p => {
            const taxRate = isTwStock(p.symbol) ? 0.0 : 0.30;
            const totalAmount = p.amount_per_share * p.quantity_at_ex_date * (1 - taxRate);
            return {
                id: `temp_${Date.now()}_${p.symbol}`,
                uid: getState().currentUserId,
                symbol: p.symbol,
                ex_dividend_date: p.ex_dividend_date,
                pay_date: p.ex_dividend_date,
                amount_per_share: p.amount_per_share,
                quantity_at_ex_date: p.quantity_at_ex_date,
                total_amount: totalAmount,
                tax_rate: taxRate * 100,
                currency: p.currency,
                notes: '批次確認',
                status: 'confirmed'
            };
        });

        const updatedConfirmed = [...newConfirmedDividends, ...confirmedDividends].sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
        
        setState({
            pendingDividends: [],
            confirmedDividends: updatedConfirmed
        });

        renderDividendsManagementTab([], updatedConfirmed);
        showNotification('info', '配息已在介面確認，正在同步至雲端...');

        apiRequest('bulk_confirm_all_dividends', { pendingDividends })
            .then(result => {
                showNotification('success', '後端同步完成！');
                requestDataSync();
            })
            .catch(error => {
                showNotification('error', `後端同步失敗: ${error.message}。建議重新整理頁面以確保資料正確。`);
            });
    });
}


async function handleDividendFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('dividend-id').value;
    const dividendData = {
        symbol: document.getElementById('dividend-symbol').value,
        ex_dividend_date: document.getElementById('dividend-ex-date').value,
        pay_date: document.getElementById('dividend-pay-date').value,
        currency: document.getElementById('dividend-currency').value,
        quantity_at_ex_date: parseFloat(document.getElementById('dividend-quantity').value),
        amount_per_share: parseFloat(document.getElementById('dividend-original-amount-ps').value),
        total_amount: parseFloat(document.getElementById('dividend-total-amount').value),
        tax_rate: parseFloat(document.getElementById('dividend-tax-rate').value) || 0,
        notes: document.getElementById('dividend-notes').value.trim()
    };
    if (id) { dividendData.id = id; }
    
    closeModal('dividend-modal');

    try {
        await apiRequest('save_user_dividend', dividendData);
        showNotification('success', '配息紀錄已儲存！');
        await loadAndShowDividends();
        await requestDataSync();
    } catch (error) {
        showNotification('error', `儲存失敗: ${error.message}`);
    }
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { confirmedDividends, pendingDividends } = getState();

    const dividendToDelete = confirmedDividends.find(d => d.id === dividendId);
    if (!dividendToDelete) return;

    showConfirm('確定要將這筆配息移回待確認區嗎？', () => {
        const updatedConfirmed = confirmedDividends.filter(d => d.id !== dividendId);
        const newPendingDividend = {
            symbol: dividendToDelete.symbol,
            ex_dividend_date: dividendToDelete.ex_dividend_date,
            amount_per_share: dividendToDelete.amount_per_share,
            quantity_at_ex_date: dividendToDelete.quantity_at_ex_date,
            currency: dividendToDelete.currency
        };
        const updatedPending = [newPendingDividend, ...pendingDividends];

        setState({
            confirmedDividends: updatedConfirmed,
            pendingDividends: updatedPending
        });

        renderDividendsManagementTab(updatedPending, updatedConfirmed);
        showNotification('info', '配息已移至待確認區，正在同步至雲端...');

        apiRequest('delete_user_dividend', { dividendId })
            .then(result => {
                showNotification('success', '後端同步完成！');
                requestDataSync();
            })
            .catch(error => {
                showNotification('error', `後端同步失敗: ${error.message}。建議重新整理頁面以確保資料正確。`);
                setState({ confirmedDividends, pendingDividends });
                renderDividendsManagementTab(pendingDividends, confirmedDividends);
            });
    });
}

function handleChartRangeChange(chartType, rangeType, startDate = null, endDate = null) {
    const stateKey = chartType === 'asset' ? 'assetDateRange' : (chartType === 'twr' ? 'twrDateRange' : 'netProfitDateRange');
    const { fullPortfolioData, isGroupView } = getState();
    
    // 必須先更新 state，這樣圖表才能拿到最新的 range
    const newRange = { type: rangeType, start: startDate, end: endDate };
    setState({ [stateKey]: newRange });

    // 如果是群組檢視模式，則不更新日期輸入框的值
    if (isGroupView) {
        // 但仍然需要觸發重繪
        const { groups, selectedGroupId } = getState();
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) {
            handleGroupFilterChange({ target: { value: selectedGroupId } }); // 觸發重算
        }
    } else {
        const historyKey = chartType === 'asset' ? 'portfolioHistory' : (chartType === 'twr' ? 'twrHistory' : 'netProfitHistory');
        const fullHistory = fullPortfolioData ? fullPortfolioData[historyKey] : {};
        const { startDate: finalStartDate, endDate: finalEndDate } = getDateRangeForPreset(fullHistory, newRange);

        if (rangeType !== 'custom') {
            document.getElementById(`${chartType}-start-date`).value = finalStartDate;
            document.getElementById(`${chartType}-end-date`).value = finalEndDate;
        }
        // 觸發圖表更新
        if (fullPortfolioData) {
            updateUIWithData(fullPortfolioData);
        }
    }
}


// --- 【全新】群組功能事件處理 ---

async function handleGroupFilterChange(e) {
    const selectedGroupId = e.target.value;
    setState({ selectedGroupId, isGroupView: selectedGroupId !== '_all_' });

    const { fullPortfolioData, groups } = getState();

    // 更新篩選器UI使其與狀態同步
    document.getElementById('group-filter-select').value = selectedGroupId;

    if (selectedGroupId === '_all_') {
        document.querySelectorAll('.chart-date-input').forEach(input => input.disabled = false);
        if (fullPortfolioData) {
            updateUIWithData(fullPortfolioData);
        } else {
            await loadPortfolioData();
        }
    } else {
        const selectedGroup = groups.find(g => g.id === selectedGroupId);
        if (selectedGroup) {
            document.querySelectorAll('.chart-date-input').forEach(input => input.disabled = true);
            
            const loadingText = document.getElementById('loading-text');
            document.getElementById('loading-overlay').style.display = 'flex';
            loadingText.textContent = `正在計算 ${selectedGroup.name} 的績效...`;
            
            try {
                const symbols = JSON.parse(selectedGroup.symbols_json);
                if (symbols.length === 0) {
                     showNotification('info', `群組 ${selectedGroup.name} 中沒有股票。`);
                     updateUIWithData({ holdingsToUpdate: {}, summaryData: {}, newFullHistory: {}, twrHistory: {}, benchmarkHistory: {}, netProfitHistory: {}});
                     return;
                }
                const filteredData = await calculateBySymbols(symbols);
                updateUIWithData(filteredData);
                showNotification('success', `已顯示 ${selectedGroup.name} 的績效報告。`);
            } catch (error) {
                showNotification('error', `計算群組績效失敗: ${error.message}`);
                e.target.value = '_all_';
                if (fullPortfolioData) updateUIWithData(fullPortfolioData);
            } finally {
                document.getElementById('loading-overlay').style.display = 'none';
            }
        }
    }
}

async function handleManageGroups() {
    try {
        await loadGroups();
        renderGroupManagementModal();
        openModal('group-management-modal');
    } catch (error) {
        showNotification('error', `無法載入群組: ${error.message}`);
    }
}

function handleGroupSelect(groupId) {
    const { groups } = getState();
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    document.querySelectorAll('#groups-list > div').forEach(el => el.classList.remove('bg-indigo-100'));
    document.querySelector(`[data-group-id="${groupId}"]`).classList.add('bg-indigo-100');

    document.getElementById('group-editor').classList.remove('hidden');
    document.getElementById('group-editor-form').reset();
    document.getElementById('group-editor-id').value = group.id;
    document.getElementById('group-editor-name').value = group.name;
    
    const symbolsList = document.getElementById('group-editor-symbols-list');
    symbolsList.innerHTML = '';
    const symbols = JSON.parse(group.symbols_json);
    symbols.forEach(symbol => {
        const symbolEl = document.createElement('div');
        symbolEl.className = 'flex justify-between items-center bg-gray-100 px-2 py-1 rounded';
        symbolEl.innerHTML = `<span>${symbol}</span><button type="button" class="remove-symbol-btn text-red-500 hover:text-red-700" data-symbol="${symbol}"><i data-lucide="x-circle" class="h-4 w-4"></i></button>`;
        symbolsList.appendChild(symbolEl);
    });
    lucide.createIcons();
}

async function handleGroupFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('group-editor-id').value;
    const name = document.getElementById('group-editor-name').value.trim();
    const symbolNodes = document.querySelectorAll('#group-editor-symbols-list span');
    const symbols = Array.from(symbolNodes).map(span => span.textContent);
    const symbols_json = JSON.stringify(symbols);
    
    if (!name) {
        showNotification('error', '群組名稱不可為空。');
        return;
    }

    try {
        const result = await saveGroup({ id, name, symbols_json });
        showNotification('success', '群組已儲存！');
        const newGroupId = id || result.id;
        await loadGroups();
        renderGroupManagementModal();
        handleGroupSelect(newGroupId); 
        renderGroupFilter();
    } catch (error) {
        showNotification('error', `儲存群組失敗: ${error.message}`);
    }
}


// --- 初始化與事件綁定 ---

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
    document.getElementById('add-transaction-btn').addEventListener('click', () => openModal('transaction-modal'));
    document.getElementById('transaction-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('cancel-btn').addEventListener('click', () => closeModal('transaction-modal'));
    document.getElementById('transactions-tab').addEventListener('click', (e) => {
        const editButton = e.target.closest('.edit-btn');
        if (editButton) { e.preventDefault(); handleEdit(editButton); return; }
        const deleteButton = e.target.closest('.delete-btn');
        if (deleteButton) { e.preventDefault(); handleDelete(deleteButton); }
    });
    document.getElementById('transactions-tab').addEventListener('change', (e) => {
        if (e.target.id === 'transaction-symbol-filter') {
            setState({ transactionFilter: e.target.value });
            renderTransactionsTable();
        }
    });
    
    const manageSplitsBtn = document.getElementById('manage-splits-btn');
    if(manageSplitsBtn) manageSplitsBtn.addEventListener('click', () => openModal('split-modal'));
    document.getElementById('split-form').addEventListener('submit', handleSplitFormSubmit);
    document.getElementById('cancel-split-btn').addEventListener('click', () => closeModal('split-modal'));
    document.getElementById('splits-table-body').addEventListener('click', (e) => { 
        const btn = e.target.closest('.delete-split-btn');
        if(btn) handleDeleteSplit(btn);
    });
    
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

    document.getElementById('dividends-tab').addEventListener('click', (e) => {
        if (e.target.closest('#bulk-confirm-dividends-btn')) { handleBulkConfirm(); return; }
        if (e.target.closest('.edit-dividend-btn')) { openModal('dividend-modal', true, { id: e.target.closest('.edit-dividend-btn').dataset.id }); return; }
        if (e.target.closest('.confirm-dividend-btn')) { openModal('dividend-modal', false, { index: e.target.closest('.confirm-dividend-btn').dataset.index }); return; }
        if (e.target.closest('.delete-dividend-btn')) { handleDeleteDividend(e.target.closest('.delete-dividend-btn')); }
    });
    document.getElementById('dividends-tab').addEventListener('change', (e) => {
        if (e.target.id === 'dividend-symbol-filter') {
            setState({ dividendFilter: e.target.value });
            const { pendingDividends, confirmedDividends } = getState();
            renderDividendsManagementTab(pendingDividends, confirmedDividends);
        }
    });
    
    document.getElementById('dividend-form').addEventListener('submit', handleDividendFormSubmit);
    document.getElementById('cancel-dividend-btn').addEventListener('click', () => closeModal('dividend-modal'));
    document.getElementById('currency').addEventListener('change', toggleOptionalFields);

    document.querySelectorAll('.chart-controls').forEach(container => {
        container.addEventListener('click', e => {
            const btn = e.target.closest('.chart-range-btn');
            if (btn) {
                handleChartRangeChange(container.dataset.chart, btn.dataset.range);
            }
        });
        container.addEventListener('change', e => {
            if (e.target.matches('.chart-date-input')) {
                const startInput = container.querySelector('.chart-date-input:first-of-type');
                const endInput = container.querySelector('.chart-date-input:last-of-type');
                if (startInput && endInput && startInput.value && endInput.value) {
                    container.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                    handleChartRangeChange(container.dataset.chart, 'custom', startInput.value, endInput.value);
                }
            }
        });
    });

    // 【新增】群組功能相關事件監聽
    document.getElementById('manage-groups-btn').addEventListener('click', handleManageGroups);
    document.getElementById('group-filter-select').addEventListener('change', handleGroupFilterChange);
    document.getElementById('close-group-modal-btn').addEventListener('click', () => closeModal('group-management-modal'));
    
    const groupModal = document.getElementById('group-management-modal');
    groupModal.addEventListener('click', e => {
        // 新增：判斷是否點擊了關閉按鈕，或是視窗外的背景
        if (e.target.closest('#close-group-modal-btn') || !e.target.closest('.bg-white')) {
            closeModal('group-management-modal');
            return;
        }

        const groupItem = e.target.closest('[data-group-id]');
        if (groupItem) {
            handleGroupSelect(groupItem.dataset.groupId);
            return;
        }

        if (e.target.closest('#create-new-group-btn')) {
            document.getElementById('group-editor').classList.remove('hidden');
            document.getElementById('group-editor-form').reset();
            document.getElementById('group-editor-id').value = '';
            document.getElementById('group-editor-symbols-list').innerHTML = '';
            document.querySelectorAll('#groups-list > div').forEach(el => el.classList.remove('bg-indigo-100'));
            return;
        }

        const removeBtn = e.target.closest('.remove-symbol-btn');
        if (removeBtn) {
            removeBtn.parentElement.remove();
            return;
        }

        if (e.target.closest('#add-symbol-btn')) {
            const input = document.getElementById('add-symbol-input');
            const symbol = input.value.trim().toUpperCase();
            if (symbol) {
                const symbolsList = document.getElementById('group-editor-symbols-list');
                 const symbolEl = document.createElement('div');
                symbolEl.className = 'flex justify-between items-center bg-gray-100 px-2 py-1 rounded';
                symbolEl.innerHTML = `<span>${symbol}</span><button type="button" class="remove-symbol-btn text-red-500 hover:text-red-700" data-symbol="${symbol}"><i data-lucide="x-circle" class="h-4 w-4"></i></button>`;
                symbolsList.appendChild(symbolEl);
                lucide.createIcons();
                input.value = '';
                input.focus();
            }
            return;
        }
        
        if (e.target.closest('#delete-group-btn')) {
            const id = document.getElementById('group-editor-id').value;
            if (!id) return;
            showConfirm('確定要刪除這個群組嗎？此操作不可復原。', async () => {
                try {
                    await deleteGroup(id);
                    showNotification('success', '群組已刪除。');
                    document.getElementById('group-editor').classList.add('hidden');
                    await loadGroups();
                    renderGroupManagementModal();
                    renderGroupFilter();
                } catch (error) {
                    showNotification('error', `刪除群組失敗: ${error.message}`);
                }
            });
        }
    });
    groupModal.querySelector('#group-editor-form').addEventListener('submit', handleGroupFormSubmit);
    groupModal.querySelector('#add-symbol-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('add-symbol-btn').click();
        }
    });
}


export function initializeAppUI() {
    if (getState().isAppInitialized) {
        return;
    }
    console.log("Initializing Main App UI...");
    initializeChart();
    initializeTwrChart();
    initializeNetProfitChart();
    
    setTimeout(async () => {
        setupMainAppEventListeners();
        lucide.createIcons();
        try {
            await loadGroups();
            renderGroupFilter();
        } catch(e) {
            console.error("首次載入群組失敗:", e);
        }
    }, 0);

    setState({ isAppInitialized: true });
}


document.addEventListener('DOMContentLoaded', () => {
    setupCommonEventListeners();
    initializeAuth(); 
});
