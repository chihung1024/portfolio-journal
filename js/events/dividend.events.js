// =========================================================================================
// == 配息事件處理模듈 (dividend.events.js) v2.0.0 - 整合操作隊列
// =========================================================================================

import { getState, setState } from '../state.js';
import { addToQueue } from '../op_queue_manager.js'; // 【新增】引入操作隊列管理器
import { showNotification } from '../ui/notifications.js';
import { renderDividendsManagementTab } from '../ui/components/dividends.ui.js';
// 【移除】不再需要直接與後端溝通
// import { apiRequest, executeApiAction } from '../api.js';
// import { loadAndShowDividends } from '../main.js';

// --- Private Functions ---

async function handleBulkConfirm() {
    const { pendingDividends } = getState();
    if (pendingDividends.length === 0) {
        showNotification('info', '沒有需要確認的配息。');
        return;
    }
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm(`您確定要一次確認 ${pendingDividends.length} 筆配息紀錄嗎？系統將套用預設稅率與發放日期。此操作將被暫存。`, () => {
        // 【核心修改】為每一筆待確認配息都建立一個 CREATE 操作並加入隊列
        const isTwStock = (symbol) => symbol ? (symbol.toUpperCase().endsWith('.TW') || symbol.toUpperCase().endsWith('.TWO')) : false;
        
        pendingDividends.forEach(p => {
            const taxRate = isTwStock(p.symbol) ? 0 : 30;
            const totalAmount = p.amount_per_share * p.quantity_at_ex_date * (1 - taxRate / 100);
            
            const dividendData = {
                symbol: p.symbol,
                ex_dividend_date: p.ex_dividend_date,
                pay_date: p.ex_dividend_date.split('T')[0],
                currency: p.currency,
                quantity_at_ex_date: p.quantity_at_ex_date,
                amount_per_share: p.amount_per_share,
                total_amount: parseFloat(totalAmount.toFixed(2)),
                tax_rate: taxRate,
                notes: '批次確認'
            };
            addToQueue('CREATE', 'user_dividend', dividendData);
        });

        // 清空前端 state 中的待確認列表
        setState({ pendingDividends: [] });

        showNotification('info', `${pendingDividends.length} 筆配息已暫存。點擊同步按鈕以儲存。`);
        
        // 立即重新渲染 UI
        const { confirmedDividends } = getState();
        renderDividendsManagementTab([], confirmedDividends);
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
    
    const { closeModal } = await import('../ui/modals.js');
    closeModal('dividend-modal');

    // 【核心修改】將操作加入隊列
    let success;
    if (isEditing) {
        dividendData.id = id;
        success = addToQueue('UPDATE', 'user_dividend', dividendData);
    } else {
        success = addToQueue('CREATE', 'user_dividend', dividendData);
    }

    if(success) {
        // 如果是從 "待確認" 來的，需要手動從 state 中移除
        if (!isEditing) {
            const { pendingDividends } = getState();
            const updatedPending = pendingDividends.filter(p => 
                !(p.symbol === dividendData.symbol && p.ex_dividend_date === dividendData.ex_dividend_date)
            );
            setState({ pendingDividends: updatedPending });
        }
        
        showNotification('info', '配息紀錄已暫存。點擊同步按鈕以儲存。');
        const { pendingDividends, confirmedDividends } = getState();
        renderDividendsManagementTab(pendingDividends, confirmedDividends);
    }
}

async function handleDeleteDividend(button) {
    const dividendId = button.dataset.id;
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要刪除這筆已確認的配息紀錄嗎？此操作將被暫存。', () => {
        // 【核心修改】將操作加入隊列
        const success = addToQueue('DELETE', 'user_dividend', { dividendId });

        if (success) {
            showNotification('info', '配息紀錄已標記為刪除。點擊同步按鈕以儲存。');
            const { pendingDividends, confirmedDividends } = getState();
            renderDividendsManagementTab(pendingDividends, confirmedDividends);
        }
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
            const { openModal } = await import('../ui/modals.js');
            openModal('dividend-modal', true, { id: editBtn.dataset.id });
            return;
        }
        const confirmBtn = e.target.closest('.confirm-dividend-btn');
        if (confirmBtn) {
            const { openModal } = await import('../ui/modals.js');
            openModal('dividend-modal', false, { index: confirmBtn.dataset.index });
            return;
        }
        const deleteBtn = e.target.closest('.delete-dividend-btn');
        if (deleteBtn) {
            handleDeleteDividend(deleteBtn);
        }
    });

    document.getElementById('dividends-tab').addEventListener('change', (e) => {
        if (e.target.id === 'dividend-symbol-filter') {
            setState({ dividendFilter: e.target.value });
            const { pendingDividends, confirmedDividends } = getState();
            renderDividendsManagementTab(pendingDividends, confirmedDividends);
        }
    });
    
    document.getElementById('dividend-form').addEventListener('submit', handleDividendFormSubmit);
    document.getElementById('cancel-dividend-btn').addEventListener('click', async () => {
        const { closeModal } = await import('../ui/modals.js');
        closeModal('dividend-modal');
    });

    document.getElementById('dividend-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.target.matches('textarea')) {
            e.preventDefault();
            document.getElementById('save-dividend-btn').click();
        }
    });
    
    document.getElementById('dividend-history-modal').addEventListener('click', async (e) => {
        if (e.target.closest('#close-dividend-history-btn') || !e.target.closest('#dividend-history-content')) {
            const { closeModal } = await import('../ui/modals.js');
            closeModal('dividend-history-modal');
        }
    });
}