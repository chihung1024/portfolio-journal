// js/events/transaction.events.js

import { addTransaction, updateTransaction, deleteTransaction, getTransactions, getHoldings } from '../api.js';
import { renderTransactionsTable } from '../ui/components/transactions.ui.js';
import { showModal, hideModal } from '../ui/modals.js';
import state from '../state.js';
import { showNotification } from '../ui/notifications.js';
import { debounce } from '../ui/utils.js';

function populateSymbolDropdown(selectElement, selectedSymbol = null) {
    const symbols = [...new Set(state.transactions.map(t => t.symbol).concat(state.holdings.map(h => h.symbol)))];
    
    // Filter out duplicates and sort
    const uniqueSymbols = [...new Set(symbols)].sort();

    selectElement.innerHTML = '<option value="">請選擇股票代號</option>';
    uniqueSymbols.forEach(symbol => {
        const option = document.createElement('option');
        option.value = symbol;
        option.textContent = symbol;
        if (symbol === selectedSymbol) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });
}


export function setupTransactionEventListeners() {
    const addTransactionBtn = document.getElementById('add-transaction-btn');
    const transactionModal = document.getElementById('transaction-modal');
    const transactionForm = document.getElementById('transaction-form');
    const cancelTransactionBtn = document.getElementById('cancel-transaction-btn');
    const transactionsTableBody = document.querySelector('#transactions-table tbody');

    // Filter event listeners
    const symbolFilter = document.getElementById('symbol-filter');
    const typeFilter = document.getElementById('type-filter');
    const startDateFilter = document.getElementById('start-date-filter');
    const endDateFilter = document.getElementById('end-date-filter');
    const resetFiltersBtn = document.getElementById('reset-filters-btn');

    if (addTransactionBtn) {
        addTransactionBtn.addEventListener('click', () => {
            transactionForm.reset();
            document.getElementById('transaction-id').value = '';
            document.getElementById('transaction-modal-title').textContent = '新增交易';
            populateSymbolDropdown(document.getElementById('symbol'));
            showModal('transaction-modal');
        });
    }

    if (transactionForm) {
        transactionForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(transactionForm);
            const transactionData = {
                symbol: formData.get('symbol').toUpperCase(),
                type: formData.get('type'),
                quantity: parseFloat(formData.get('quantity')),
                price: parseFloat(formData.get('price')),
                date: formData.get('date'),
            };
            const transactionId = formData.get('id');

            try {
                if (transactionId) {
                    await updateTransaction(transactionId, transactionData);
                    showNotification('交易更新成功', 'success');
                } else {
                    await addTransaction(transactionData);
                    showNotification('交易新增成功', 'success');
                }
                hideModal('transaction-modal');
                // Refresh both transactions and holdings data
                await getTransactions();
                await getHoldings();
                renderTransactionsTable();
            } catch (error) {
                showNotification(`操作失敗: ${error.message}`, 'error');
            }
        });
    }

    if (cancelTransactionBtn) {
        cancelTransactionBtn.addEventListener('click', () => {
            hideModal('transaction-modal');
        });
    }

    if (transactionsTableBody) {
        transactionsTableBody.addEventListener('click', (event) => {
            const target = event.target;
            const transactionId = target.closest('tr').dataset.id;
            
            if (target.matches('.edit-transaction-btn, .edit-transaction-btn *')) {
                const transaction = state.transactions.find(t => t.id === transactionId);
                if (transaction) {
                    document.getElementById('transaction-id').value = transaction.id;
                    document.getElementById('transaction-modal-title').textContent = '編輯交易';
                    populateSymbolDropdown(document.getElementById('symbol'), transaction.symbol);
                    document.getElementById('type').value = transaction.type;
                    document.getElementById('quantity').value = transaction.quantity;
                    document.getElementById('price').value = transaction.price;
                    document.getElementById('date').value = transaction.date;
                    showModal('transaction-modal');
                }
            }
    
            if (target.matches('.delete-transaction-btn, .delete-transaction-btn *')) {
                if (confirm('確定要刪除這筆交易嗎？')) {
                    deleteTransaction(transactionId).then(async () => {
                        showNotification('交易刪除成功', 'success');
                        await getTransactions();
                        await getHoldings();
                        renderTransactionsTable();
                    }).catch(error => {
                        showNotification(`刪除失敗: ${error.message}`, 'error');
                    });
                }
            }
        });
    }

    // --- Filter Logic ---
    const applyFilters = debounce(() => {
        state.transactionFilter.symbol = symbolFilter.value;
        state.transactionFilter.type = typeFilter.value;
        state.transactionFilter.startDate = startDateFilter.value;
        state.transactionFilter.endDate = endDateFilter.value;
        renderTransactionsTable();
    }, 300);

    if (symbolFilter) symbolFilter.addEventListener('input', applyFilters);
    if (typeFilter) typeFilter.addEventListener('change', applyFilters);
    if (startDateFilter) startDateFilter.addEventListener('change', applyFilters);
    if (endDateFilter) endDateFilter.addEventListener('change', applyFilters);

    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', () => {
            symbolFilter.value = '';
            typeFilter.value = '';
            startDateFilter.value = '';
            endDateFilter.value = '';
            
            state.transactionFilter.symbol = '';
            state.transactionFilter.type = '';
            state.transactionFilter.startDate = '';
            state.transactionFilter.endDate = '';
            renderTransactionsTable();
        });
    }
}
