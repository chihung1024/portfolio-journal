// =========================================================================================
// == 交易紀錄 UI 模組 (transactions.ui.js) v3.0 - 整合暫存區
// =========================================================================================

import { getState } from '../../state.js';
import { isTwStock, formatNumber, findFxRateForFrontend } from '../utils.js';
import { stagingService } from '../../staging.service.js';

/**
 * 產生智慧型自適應分頁控制項的 HTML
 * @param {number} totalItems - 總項目數
 * @param {number} itemsPerPage - 每頁項目數
 * @param {number} currentPage - 當前頁碼
 * @returns {string} - 分頁控制項的 HTML 字串
 */
function renderPaginationControls(totalItems, itemsPerPage, currentPage) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (totalPages <= 1) return '';

    let paginationHtml = '<nav aria-label="Page navigation"><ul class="pagination justify-content-center flex-wrap">';
    
    paginationHtml += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${currentPage - 1}">上一頁</a></li>`;

    let lastPageRendered = 0;
    for (let i = 1; i <= totalPages; i++) {
        const isFirstPage = i === 1;
        const isLastPage = i === totalPages;
        const isInContext = Math.abs(i - currentPage) <= 1;

        if (isFirstPage || isLastPage || isInContext) {
            if (i > lastPageRendered + 1) {
                paginationHtml += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
            const isActive = i === currentPage;
            paginationHtml += `<li class="page-item ${isActive ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
            lastPageRendered = i;
        }
    }

    paginationHtml += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${currentPage + 1}">下一頁</a></li>`;
    paginationHtml += '</ul></nav>';
    return paginationHtml;
}


export async function renderTransactionsTable() {
    const { transactions, transactionFilter, transactionsPerPage, transactionsCurrentPage } = getState();
    const container = document.getElementById('transactions-content');
    if (!container) return;

    // 1. 獲取暫存的操作
    const stagedActions = await stagingService.getActions();
    const transactionActions = stagedActions.filter(a => a.entity === 'TRANSACTION');

    const stagedUpdates = new Map(
        transactionActions.filter(a => a.type === 'UPDATE').map(a => [a.payload.id, a.payload])
    );
    const stagedDeletes = new Set(
        transactionActions.filter(a => a.type === 'DELETE').map(a => a.payload.id)
    );
    const stagedCreates = transactionActions
        .filter(a => a.type === 'CREATE')
        .map(a => a.payload);

    // 2. 結合 state 中的交易與暫存區中的新交易
    const baseTransactions = transactions.map(t => {
        if (stagedUpdates.has(t.id)) {
            return { ...t, ...stagedUpdates.get(t.id) }; // 合併更新後的資料
        }
        return t;
    });

    let displayTransactions = [...baseTransactions, ...stagedCreates]
        .sort((a, b) => new Date(b.date) - new Date(a.date)); // 按日期排序

    // 3. 篩選交易
    const uniqueSymbols = ['all', ...Array.from(new Set(displayTransactions.map(t => t.symbol)))];
    const filterHtml = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <div class="flex-grow-1 me-3">
                <label for="transaction-symbol-filter" class="form-label">篩選股票</label>
                <input type="text" id="transaction-symbol-filter" class="form-control" list="symbol-datalist" placeholder="輸入或選擇代碼..." value="${transactionFilter === 'all' ? '' : transactionFilter}">
                <datalist id="symbol-datalist">
                    ${uniqueSymbols.map(s => `<option value="${s === 'all' ? '' : s}"></option>`).join('')}
                </datalist>
            </div>
            <div class="align-self-end">
                <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#transaction-modal">新增交易</button>
            </div>
        </div>`;

    const filteredTransactions = transactionFilter === 'all' || !transactionFilter 
        ? displayTransactions 
        : displayTransactions.filter(t => t.symbol.toLowerCase().includes(transactionFilter.toLowerCase()));
    
    // 4. 分頁
    const startIndex = (transactionsCurrentPage - 1) * transactionsPerPage;
    const endIndex = startIndex + transactionsPerPage;
    const paginatedTransactions = filteredTransactions.slice(startIndex, endIndex);

    // 5. 渲染帶有視覺提示的表格
    const tableHtml = `
    <div class="table-responsive">
        <table class="table table-hover align-middle">
            <thead class="table-light">
                <tr>
                    <th>日期</th><th>代碼</th><th>類型</th><th>股數</th><th>價格(原幣)</th><th>總金額(TWD)</th><th class="text-center">操作</th>
                </tr>
            </thead>
            <tbody id="transactions-table-body">
                ${paginatedTransactions.length > 0 ? paginatedTransactions.map(t => {
                    let rowClass = '';
                    let isDeleted = false;
                    if (stagedDeletes.has(t.id)) {
                        rowClass = 'table-danger opacity-75';
                        isDeleted = true;
                    } else if (stagedUpdates.has(t.id)) {
                        rowClass = 'table-warning';
                    } else if (t.id.startsWith('temp_')) {
                        rowClass = 'table-success';
                    }

                    const transactionDate = t.date.split('T')[0];
                    const fxRate = t.exchangeRate || findFxRateForFrontend(t.currency, transactionDate);
                    const totalAmountTWD = (t.totalCost || (t.quantity * t.price)) * fxRate;
                    
                    return `<tr class="${rowClass}">
                        <td>${transactionDate}</td>
                        <td class="fw-bold">${t.symbol.toUpperCase()}</td>
                        <td class="fw-semibold ${t.type === 'buy' ? 'text-danger' : 'text-success'}">${t.type === 'buy' ? '買入' : '賣出'}</td>
                        <td>${formatNumber(t.quantity, isTwStock(t.symbol) ? 0 : 2)}</td>
                        <td>${formatNumber(t.price)} <span class="text-muted small">${t.currency || ''}</span></td>
                        <td>${formatNumber(totalAmountTWD, 0)}</td>
                        <td class="text-center">
                            <button data-id="${t.id}" class="btn btn-sm btn-outline-primary edit-btn me-1" ${isDeleted ? 'disabled' : ''}>編輯</button>
                            <button data-id="${t.id}" class="btn btn-sm btn-outline-danger delete-btn" ${isDeleted ? 'disabled' : ''}>刪除</button>
                        </td>
                    </tr>`;
                }).join('') : `<tr><td colspan="7" class="text-center py-5 text-muted">沒有符合條件的交易紀錄。</td></tr>`}
            </tbody>
        </table>
    </div>`;
    
    const paginationControls = renderPaginationControls(filteredTransactions.length, transactionsPerPage, transactionsCurrentPage);

    container.innerHTML = filterHtml + tableHtml + `<div id="transactions-pagination" class="mt-3">${paginationControls}</div>`;
}
