// =========================================================================================
// == 交易事件處理模組 (transaction.events.js) v3.0 - 整合暫存區
// =========================================================================================

import { getState, setState } from '../state.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { showNotification } from '../ui/notifications.js';
import { stagingService } from '../staging.service.js';
import { updateStagedCountBadge } from './staging.events.js';


// --- Private Functions (內部函式) ---

async function handleEdit(button) {
    const { transactions } = getState();
    const txId = button.dataset.id;
    
    // TODO: 需增加邏輯以處理已存在於暫存區中的項目
    // 目前暫定只能編輯尚未被暫存的原始交易
    const transaction = transactions.find(t => t.id === txId);
    if (!transaction) {
        showNotification('error', `在當前狀態中找不到 ID 為 ${txId} 的交易。`);
        return;
    };
    
    const { openModal } = await import('../ui/modals.js');
    // 使用 transaction 的資料填充 modal
    openModal('transaction-modal', transaction);
}


async function handleDelete(button) {
    const txId = button.dataset.id;
    
    const { showConfirm } = await import('../ui/modals.js');
    showConfirm('確定要將這筆交易的刪除操作加入暫存區嗎？', async () => {
        try {
            await stagingService.addAction({
                type: 'DELETE',
                entity: 'TRANSACTION',
                payload: { id: txId }
            });
            showNotification('success', '刪除操作已加入暫存區。');
            await updateStagedCountBadge();
            
            // 重新渲染表格，新的渲染邏輯需要根據暫存狀態來顯示特殊樣式
            renderTransactionsTable(); 

        } catch (error) {
            console.error("Failed to stage delete action:", error);
            showNotification('error', '加入暫存區失敗。');
        }
    });
}

// 處理交易表單提交 (新增/編輯)
async function handleTransactionFormSubmit() {
    const form = document.getElementById('transaction-form');
    const txId = form.querySelector('#transaction-id').value;
    const isEditing = !!txId;

    const transactionData = {
        type: form.querySelector('#transaction-type').value,
        symbol: form.querySelector('#transaction-symbol').value.toUpperCase().trim(),
        date: form.querySelector('#transaction-date').value,
        quantity: parseFloat(form.querySelector('#transaction-quantity').value),
        price: parseFloat(form.querySelector('#transaction-price').value),
        fee: parseFloat(form.querySelector('#transaction-fee').value) || 0,
        group_id: form.querySelector('#transaction-group').value || null
    };

    if (!transactionData.symbol || !transactionData.date || isNaN(transactionData.quantity) || isNaN(transactionData.price)) {
        showNotification('error', '請填寫所有必填欄位 (代碼、日期、股數、價格)。');
        return;
    }
    
    const { closeModal } = await import('../ui/modals.js');
    
    try {
        if (isEditing) {
            await stagingService.addAction({
                type: 'UPDATE',
                entity: 'TRANSACTION',
                payload: { id: txId, ...transactionData }
            });
            showNotification('success', '編輯操作已加入暫存區。');
        } else {
            // 對於新交易，我們在客戶端生成一個臨時ID，以便在提交到後端之前進行跟踪。
            const tempId = `temp_${self.crypto.randomUUID()}`;
            await stagingService.addAction({
                type: 'CREATE',
                entity: 'TRANSACTION',
                payload: { id: tempId, ...transactionData }
            });
            showNotification('success', '新增操作已加入暫存區。');
        }

        await updateStagedCountBadge();
        closeModal('transaction-modal');
        
        // 重新渲染表格以顯示帶有視覺提示的新/更新項目。
        renderTransactionsTable();

    } catch (error) {
        console.error("Failed to stage transaction action:", error);
        showNotification('error', '加入暫存區失敗。');
    }
}


// --- Public Function (公開函式，由 main.js 呼叫) ---

export function initializeTransactionEventListeners() {
    const transactionModal = document.getElementById('transaction-modal');
    const transactionsTabContent = document.getElementById('transactions-content');

    // 監聽 "新增交易" 按鈕
    const addTransactionBtn = document.querySelector('[data-bs-target="#transaction-modal"]');
    if (addTransactionBtn) {
        addTransactionBtn.addEventListener('click', async () => {
            const { openModal } = await import('../ui/modals.js');
            openModal('transaction-modal'); // openModal 內部應處理重置表單
        });
    }

    // 監聽 Modal 內的表單提交事件
    if (transactionModal) {
        const form = transactionModal.querySelector('#transaction-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            handleTransactionFormSubmit();
        });
    }
    
    // 使用事件委派來處理表格中的所有點擊事件
    if (transactionsTabContent) {
        transactionsTabContent.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            if (button.classList.contains('edit-btn')) {
                e.preventDefault();
                handleEdit(button);
                return;
            }

            if (button.classList.contains('delete-btn')) {
                e.preventDefault();
                handleDelete(button);
                return;
            }
        });

        // 處理分頁按鈕
        const paginationContainer = document.getElementById('transactions-pagination');
        if (paginationContainer) {
            paginationContainer.addEventListener('click', (e) => {
                const pageButton = e.target.closest('.page-link');
                if(pageButton) {
                    e.preventDefault();
                    const newPage = parseInt(pageButton.dataset.page, 10);
                    if (!isNaN(newPage) && newPage > 0) {
                        setState({ transactionsCurrentPage: newPage });
                        renderTransactionsTable(); 
                    }
                }
            });
        }

        // 處理篩選器變更
        const filterInput = document.getElementById('transaction-symbol-filter');
        if(filterInput) {
            filterInput.addEventListener('input', (e) => {
                setState({ 
                    transactionFilter: e.target.value,
                    transactionsCurrentPage: 1 
                });
                renderTransactionsTable();
            });
        }
    }
}
