// =========================================================================================
// == 配息事件處理模組 (dividend.events.js) v2.0.0 - (核心重構) 支援 ATLAS-COMMIT
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';
import { loadAndShowDividends } from '../main.js';
import { updateStagingBanner } from '../ui/components/stagingBanner.ui.js';
import { v4 as uuidv4 } from 'https://jspm.dev/uuid';

// --- Private Functions ---

async function handleBulkConfirm() {
    const { pendingDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }
    
    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？此操作將加入待辦清單。`, () => {
        const currentState = getState();
        let stagedChangesToAdd = [];
        let newConfirmedDividends = [...currentState.confirmedDividends];

        // 步驟 1: 樂觀更新
        pendingDividends.forEach(pending => {
            const entityId = uuidv4();
            const taxRate = (pending.symbol.toUpperCase().endsWith('.TW') || pending.symbol.toUpperCase().endsWith('.TWO')) ? 0 : 30;
            const totalAmount = pending.amount_per_share * pending.quantity_at_ex_date * (1 - taxRate / 100);

            const newConfirmed = {
                ...pending,
                id: entityId,
                pay_date: pending.ex_dividend_date,
                tax_rate: taxRate,
                total_amount: totalAmount,
                notes: '批次確認',
                status: 'STAGED_CREATE'
            };
            newConfirmedDividends.unshift(newConfirmed);
            
            stagedChangesToAdd.push({
                id: entityId,
                op: 'CREATE',
                entity: 'dividend',
                payload: newConfirmed
            });
        });

        setState({
            pendingDividends: [], // 清空待確認列表
            confirmedDividends: newConfirmedDividends,
            stagedChanges: [...currentState.stagedChanges, ...stagedChangesToAdd],
            hasStagedChanges: true
        });

        renderDividendsManagementTab([], newConfirmedDividends);
        updateStagingBanner();

        // 步驟 2: 背景發送多個暫存請求
        const stagePromises = stagedChangesToAdd.map(change => 
            apiRequest('stage_change', { op: change.op, entity: change.entity, payload: change.payload })
        );

        Promise.all(stagePromises)
            .then(() => {
                showNotification('info', `${stagedChangesToAdd.length} 筆配息確認已加入待辦。`);
            })
            .catch(error => {
                showNotification('error', `批次暫存配息失敗: ${error.message}，建議刷新頁面。`);
                // 由於批次還原複雜，引導使用者刷新
            });
    });
}

async function handleDividendFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('dividend-id').value;
    const isEditing = !!id;

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
    
    closeModal('dividend-modal');

    const op = isEditing ? 'UPDATE' : 'CREATE';
    const entityId = isEditing ? id : uuidv4();
    const payload = { ...dividendData, id: entityId };

    // 步驟 1: 樂觀更新 UI
    const currentState = getState();
    let updatedConfirmedDividends;
    let updatedPendingDividends = [...currentState.pendingDividends];

    if (isEditing) {
        updatedConfirmedDividends = currentState.confirmedDividends.map(d => 
            d.id === entityId ? { ...d, ...payload, status: 'STAGED_UPDATE' } : d
        );
    } else {
        // 從待辦列表中移除
        updatedPendingDividends = currentState.pendingDividends.filter(p => 
            !(p.symbol === payload.symbol && p.ex_dividend_date === payload.ex_dividend_date)
        );
        const newDividend = { ...payload, status: 'STAGED_CREATE' };
        updatedConfirmedDividends = [newDividend, ...currentState.confirmedDividends];
    }
    
    const change = { id: entityId, op, entity: 'dividend', payload };

    setState({
        confirmedDividends: updatedConfirmedDividends,
        pendingDividends: updatedPendingDividends,
        stagedChanges: [...currentState.stagedChanges, change],
        hasStagedChanges: true
    });

    renderDividendsManagementTab(updatedPendingDividends, updatedConfirmedDividends);
    updateStagingBanner();
    
    // 步驟 2: 背景發送暫存請求
    apiRequest('stage_change', { op, entity: 'dividend', payload })
        .then(() => {
            showNotification('info', '一筆配息變更已加入待辦。');
        })
        .catch(error => {
            showNotification('error', `暫存配息變更失敗: ${error.message}，建議刷新頁面。`);
        });
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    
    showConfirm('確定要刪除這筆已確認的配息紀錄嗎？此操作將加入待辦清單。', () => {
        const currentState = getState();
        
        // 步驟 1: 樂觀更新
        const updatedConfirmed = currentState.confirmedDividends.map(d => 
            d.id === dividendId ? { ...d, status: 'STAGED_DELETE' } : d
        );

        const change = { id: dividendId, op: 'DELETE', entity: 'dividend', payload: { id: dividendId } };

        setState({
            confirmedDividends: updatedConfirmed,
            stagedChanges: [...currentState.stagedChanges, change],
            hasStagedChanges: true,
        });
        
        renderDividendsManagementTab(currentState.pendingDividends, updatedConfirmed);
        updateStagingBanner();

        // 步驟 2: 背景暫存
        apiRequest('stage_change', { op: 'DELETE', entity: 'dividend', payload: { id: dividendId }})
            .then(() => {
                showNotification('info', '一筆配息刪除操作已加入待辦。');
            })
            .catch(error => {
                showNotification('error', `暫存配息刪除失敗: ${error.message}，建議刷新頁面。`);
            });
    });
}

// --- Public Function ---

export function initializeDividendEventListeners() {
    document.getElementById('dividends-tab').addEventListener('click', async (e) => {
        const bulkConfirmBtn = e.target.closest('#bulk-confirm-dividends-btn');
        if (bulkConfirmBtn) {
            handleBulkConfirm();
            return;
        }
        const editBtn = e.target.closest('.edit-dividend-btn');
        if (editBtn) {
            openModal('dividend-modal', true, { id: editBtn.dataset.id });
            return;
        }
        const confirmBtn = e.target.closest('.confirm-dividend-btn');
        if (confirmBtn) {
            openModal('dividend-modal', false, { index: confirmBtn.dataset.index });
            return;
        }
        const deleteBtn = e.target.closest('.delete-dividend-btn');
        if (deleteBtn) {
            handleDeleteDividend(deleteBtn);
        }
        // TODO: Add revert change logic here
    });

    document.getElementById('dividends-tab').addEventListener('change', (e) => {
        if (e.target.id === 'dividend-symbol-filter') {
            setState({ dividendFilter: e.target.value });
            const { pendingDividends, confirmedDividends } = getState();
            renderDividendsManagementTab(pendingDividends, confirmedDividends);
        }
    });
    
    document.getElementById('dividend-form').addEventListener('submit', handleDividendFormSubmit);
    
    document.getElementById('cancel-dividend-btn').addEventListener('click', () => {
        closeModal('dividend-modal');
    });

    document.getElementById('dividend-history-modal').addEventListener('click', (e) => {
        if (e.target.closest('#close-dividend-history-btn') || !e.target.closest('#dividend-history-content')) {
            closeModal('dividend-history-modal');
        }
    });
}
