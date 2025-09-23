// =========================================================================================
// == 交易選擇器元件 (transactionSelector.ui.js) v1.0 - 群組管理增強
// =========================================================================================

import { getState } from '../../state.js';
import { formatNumber, formatDate } from '../utils.js';
import { apiRequest } from '../../api.js';
import { showNotification } from '../notifications.js';

/**
 * 交易選擇器狀態管理
 */
class TransactionSelectorState {
    constructor() {
        this.allTransactions = [];
        this.filteredTransactions = [];
        this.selectedTransactionIds = new Set();
        this.conflictTransactionIds = new Set();
        this.filters = {
            searchText: '',
            symbol: '',
            dateRange: '',
            transactionType: []
        };
        this.isInitialized = false;
    }

    reset() {
        this.selectedTransactionIds.clear();
        this.conflictTransactionIds.clear();
        this.filters = {
            searchText: '',
            symbol: '',
            dateRange: '',
            transactionType: []
        };
    }

    getSelectedCount() {
        return this.selectedTransactionIds.size;
    }

    getVisibleSelectedCount() {
        return this.filteredTransactions.filter(tx => 
            this.selectedTransactionIds.has(tx.id)
        ).length;
    }
}

// 全局狀態實例
const selectorState = new TransactionSelectorState();

/**
 * 防抖函數實現
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 獲取日期範圍的截止日期
 */
function getDateCutoff(range) {
    const now = new Date();
    switch (range) {
        case '1m':
            return new Date(now.setMonth(now.getMonth() - 1));
        case '3m':
            return new Date(now.setMonth(now.getMonth() - 3));
        case '6m':
            return new Date(now.setMonth(now.getMonth() - 6));
        case '1y':
            return new Date(now.setFullYear(now.getFullYear() - 1));
        default:
            return new Date('1970-01-01');
    }
}

/**
 * 篩選交易記錄
 */
function filterTransactions(transactions, filters) {
    return transactions.filter(tx => {
        // 文字搜尋
        if (filters.searchText) {
            const searchLower = filters.searchText.toLowerCase();
            const txDate = new Date(tx.date).toLocaleDateString('zh-TW');
            if (!tx.symbol.toLowerCase().includes(searchLower) && 
                !txDate.includes(filters.searchText)) {
                return false;
            }
        }
        
        // 股票代碼篩選
        if (filters.symbol && tx.symbol !== filters.symbol) {
            return false;
        }
        
        // 日期範圍篩選
        if (filters.dateRange) {
            const txDate = new Date(tx.date);
            const cutoffDate = getDateCutoff(filters.dateRange);
            if (txDate < cutoffDate) {
                return false;
            }
        }
        
        // 交易類型篩選
        if (filters.transactionType.length > 0 && 
            !filters.transactionType.includes(tx.type)) {
            return false;
        }
        
        return true;
    });
}

/**
 * 渲染交易記錄行
 */
function renderTransactionRow(transaction) {
    const isSelected = selectorState.selectedTransactionIds.has(transaction.id);
    const isConflict = selectorState.conflictTransactionIds.has(transaction.id);
    
    const statusClass = isConflict ? 'bg-yellow-50' : '';
    const selectedClass = isSelected ? 'bg-indigo-50' : '';
    const checkboxDisabled = isConflict ? 'disabled title="此交易已被其他群組使用"' : '';
    
    const totalAmount = transaction.quantity * transaction.price;
    
    return `
        <tr class="${statusClass} ${selectedClass} hover:bg-gray-50 transition-colors duration-150" data-tx-id="${transaction.id}">
            <td class="px-3 py-2">
                <input type="checkbox" 
                       class="transaction-checkbox h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500" 
                       value="${transaction.id}"
                       ${isSelected ? 'checked' : ''}
                       ${checkboxDisabled}
                       data-symbol="${transaction.symbol}"
                       data-date="${transaction.date}">
            </td>
            <td class="px-3 py-2 text-sm text-gray-900">${formatDate(transaction.date)}</td>
            <td class="px-3 py-2">
                <div class="flex items-center space-x-2">
                    <span class="font-medium text-gray-900">${transaction.symbol}</span>
                    ${isConflict ? 
                        '<span class="inline-flex items-center px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">已在其他群組</span>' 
                        : ''}
                </div>
            </td>
            <td class="px-3 py-2">
                <span class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                    transaction.type === 'buy' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                }">
                    ${transaction.type === 'buy' ? '買入' : '賣出'}
                </span>
            </td>
            <td class="px-3 py-2 text-sm text-gray-900">${formatNumber(transaction.quantity)}</td>
            <td class="px-3 py-2 text-sm text-gray-900">${formatNumber(transaction.price)} ${transaction.currency}</td>
            <td class="px-3 py-2 text-sm font-medium text-gray-900">
                ${formatNumber(totalAmount)} ${transaction.currency}
            </td>
        </tr>
    `;
}

/**
 * 渲染交易列表
 */
function renderTransactionList() {
    const tbody = document.getElementById('transaction-selection-list');
    if (!tbody) return;

    selectorState.filteredTransactions = filterTransactions(
        selectorState.allTransactions, 
        selectorState.filters
    );

    if (selectorState.filteredTransactions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="px-3 py-8 text-center text-sm text-gray-500">
                    ${selectorState.allTransactions.length === 0 
                        ? '目前沒有任何交易記錄' 
                        : '沒有符合篩選條件的交易記錄'}
                </td>
            </tr>
        `;
        updateSelectionCount();
        updateSelectAllState();
        return;
    }

    tbody.innerHTML = selectorState.filteredTransactions
        .map(tx => renderTransactionRow(tx))
        .join('');

    updateSelectionCount();
    updateSelectAllState();
}

/**
 * 更新選擇數量顯示
 */
function updateSelectionCount() {
    const countElement = document.getElementById('selection-count');
    if (!countElement) return;

    const totalSelected = selectorState.getSelectedCount();
    const visibleSelected = selectorState.getVisibleSelectedCount();
    const totalVisible = selectorState.filteredTransactions.length;

    if (totalSelected === 0) {
        countElement.textContent = '未選擇任何交易';
        countElement.className = 'text-sm text-gray-500';
    } else if (visibleSelected === totalSelected) {
        countElement.textContent = `已選擇 ${totalSelected} 筆交易`;
        countElement.className = 'text-sm text-indigo-600 font-medium';
    } else {
        countElement.textContent = `已選擇 ${totalSelected} 筆交易（可見 ${visibleSelected}/${totalVisible}）`;
        countElement.className = 'text-sm text-indigo-600 font-medium';
    }
}

/**
 * 更新全選按鈕狀態
 */
function updateSelectAllState() {
    const headerCheckbox = document.getElementById('select-all-header');
    if (!headerCheckbox) return;

    const visibleTransactions = selectorState.filteredTransactions.filter(
        tx => !selectorState.conflictTransactionIds.has(tx.id)
    );
    const visibleSelectedCount = visibleTransactions.filter(
        tx => selectorState.selectedTransactionIds.has(tx.id)
    ).length;

    if (visibleSelectedCount === 0) {
        headerCheckbox.checked = false;
        headerCheckbox.indeterminate = false;
    } else if (visibleSelectedCount === visibleTransactions.length) {
        headerCheckbox.checked = true;
        headerCheckbox.indeterminate = false;
    } else {
        headerCheckbox.checked = false;
        headerCheckbox.indeterminate = true;
    }
}

/**
 * 處理搜尋輸入
 */
const handleSearch = debounce((searchText) => {
    selectorState.filters.searchText = searchText;
    renderTransactionList();
}, 300);

/**
 * 處理篩選變更
 */
function handleFilterChange() {
    const symbolFilter = document.getElementById('symbol-filter');
    const dateRangeFilter = document.getElementById('date-range-filter');

    if (symbolFilter) {
        selectorState.filters.symbol = symbolFilter.value;
    }
    if (dateRangeFilter) {
        selectorState.filters.dateRange = dateRangeFilter.value;
    }

    renderTransactionList();
}

/**
 * 處理全選/取消全選
 */
function handleSelectAll(checked) {
    const visibleTransactions = selectorState.filteredTransactions.filter(
        tx => !selectorState.conflictTransactionIds.has(tx.id)
    );

    if (checked) {
        visibleTransactions.forEach(tx => {
            selectorState.selectedTransactionIds.add(tx.id);
        });
    } else {
        visibleTransactions.forEach(tx => {
            selectorState.selectedTransactionIds.delete(tx.id);
        });
    }

    renderTransactionList();
}

/**
 * 處理單個交易選擇
 */
function handleTransactionSelection(transactionId, checked) {
    if (checked) {
        selectorState.selectedTransactionIds.add(transactionId);
    } else {
        selectorState.selectedTransactionIds.delete(transactionId);
    }

    updateSelectionCount();
    updateSelectAllState();
}

/**
 * 獲取所有唯一股票代碼
 */
function getUniqueSymbols() {
    return [...new Set(selectorState.allTransactions.map(tx => tx.symbol))].sort();
}

/**
 * 渲染篩選選項
 */
function renderFilterOptions() {
    const symbolFilter = document.getElementById('symbol-filter');
    if (!symbolFilter) return;

    const symbols = getUniqueSymbols();
    const currentValue = symbolFilter.value;

    symbolFilter.innerHTML = `
        <option value="">所有股票 (${selectorState.allTransactions.length})</option>
        ${symbols.map(symbol => {
            const count = selectorState.allTransactions.filter(tx => tx.symbol === symbol).length;
            return `<option value="${symbol}" ${symbol === currentValue ? 'selected' : ''}>${symbol} (${count})</option>`;
        }).join('')}
    `;
}

/**
 * 初始化交易選擇器
 */
export async function initializeTransactionSelector(groupId = null, preSelectedIds = new Set()) {
    try {
        // 重置狀態
        selectorState.reset();
        
        // 載入所有交易記錄
        const { transactions } = getState();
        selectorState.allTransactions = [...transactions].sort(
            (a, b) => new Date(b.date) - new Date(a.date)
        );

        // 設置預選交易
        preSelectedIds.forEach(id => {
            selectorState.selectedTransactionIds.add(id);
        });

        // 檢查交易衝突（如果是編輯現有群組）
        if (groupId) {
            try {
                const conflictResult = await apiRequest('check_transaction_conflicts', {
                    transactionIds: selectorState.allTransactions.map(tx => tx.id),
                    excludeGroupId: groupId
                });
                
                if (conflictResult.success) {
                    selectorState.conflictTransactionIds = new Set(conflictResult.data.conflictIds);
                }
            } catch (error) {
                console.warn('檢查交易衝突失敗:', error);
            }
        }

        // 渲染界面
        renderFilterOptions();
        renderTransactionList();
        
        selectorState.isInitialized = true;
        
    } catch (error) {
        console.error('初始化交易選擇器失敗:', error);
        showNotification('error', '載入交易記錄失敗');
    }
}

/**
 * 綁定事件監聽器
 */
export function bindTransactionSelectorEvents() {
    // 搜尋輸入
    const searchInput = document.getElementById('transaction-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            handleSearch(e.target.value);
        });
    }

    // 篩選選擇器
    const symbolFilter = document.getElementById('symbol-filter');
    const dateRangeFilter = document.getElementById('date-range-filter');
    
    if (symbolFilter) {
        symbolFilter.addEventListener('change', handleFilterChange);
    }
    if (dateRangeFilter) {
        dateRangeFilter.addEventListener('change', handleFilterChange);
    }

    // 全選按鈕
    const headerCheckbox = document.getElementById('select-all-header');
    if (headerCheckbox) {
        headerCheckbox.addEventListener('change', (e) => {
            handleSelectAll(e.target.checked);
        });
    }

    // 批次操作按鈕
    const selectAllBtn = document.getElementById('select-all-visible');
    const deselectAllBtn = document.getElementById('deselect-all-visible');
    
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => handleSelectAll(true));
    }
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => handleSelectAll(false));
    }

    // 交易選擇器事件委派
    const transactionList = document.getElementById('transaction-selection-list');
    if (transactionList) {
        transactionList.addEventListener('change', (e) => {
            if (e.target.classList.contains('transaction-checkbox')) {
                const transactionId = parseInt(e.target.value);
                handleTransactionSelection(transactionId, e.target.checked);
            }
        });
    }
}

/**
 * 獲取當前選擇的交易ID
 */
export function getSelectedTransactionIds() {
    return Array.from(selectorState.selectedTransactionIds);
}

/**
 * 設置選擇的交易ID
 */
export function setSelectedTransactionIds(transactionIds) {
    selectorState.selectedTransactionIds = new Set(transactionIds);
    if (selectorState.isInitialized) {
        renderTransactionList();
    }
}

/**
 * 清除所有選擇
 */
export function clearAllSelections() {
    selectorState.selectedTransactionIds.clear();
    if (selectorState.isInitialized) {
        renderTransactionList();
    }
}

/**
 * 獲取篩選統計信息
 */
export function getFilterStats() {
    return {
        total: selectorState.allTransactions.length,
        filtered: selectorState.filteredTransactions.length,
        selected: selectorState.getSelectedCount(),
        visibleSelected: selectorState.getVisibleSelectedCount(),
        conflicts: selectorState.conflictTransactionIds.size
    };
}

/**
 * 銷毀選擇器（清理資源）
 */
export function destroyTransactionSelector() {
    selectorState.reset();
    selectorState.isInitialized = false;
}
