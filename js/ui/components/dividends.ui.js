// =========================================================================================
// == 配息管理 UI 模組 (dividends.ui.js) v2.0 - 整合暫存區
// =========================================================================================

import { getState } from '../../state.js';
import { isTwStock, formatNumber } from '../utils.js';
import { stagingService } from '../../staging.service.js';

export async function renderDividendsManagementTab() {
    const { pendingDividends, confirmedDividends, dividendFilter } = getState();
    const container = document.getElementById('dividends-tab');
    if (!container) return;

    // 1. 獲取所有配息相關的暫存操作
    const stagedActions = (await stagingService.getActions()).filter(a => a.entity === 'DIVIDEND');
    const stagedCreates = stagedActions.filter(a => a.type === 'CREATE').map(a => a.payload);
    const stagedUpdates = new Map(stagedActions.filter(a => a.type === 'UPDATE').map(a => [a.payload.id, a.payload]));
    const stagedDeletes = new Set(stagedActions.filter(a => a.type === 'DELETE').map(a => a.payload.id));

    // 建立一個查找表，用於快速判斷某個「待確認配息」是否已被暫存
    const stagedPendingIds = new Set(stagedCreates.map(c => `${c.symbol}|${c.ex_dividend_date}`));

    // 2. 渲染「待確認配息」表格
    const pendingHtml = `
        <div class="mb-5">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h3 class="h5 mb-0">待確認配息</h3>
                ${pendingDividends.length > 0 ? `<button id="bulk-confirm-dividends-btn" class="btn btn-info">一鍵全部確認</button>` : ''}
            </div>
            <div class="table-responsive">
                <table class="table table-sm">
                    <thead><tr><th>代碼</th><th>除息日</th><th>當時股數</th><th>每股配息</th><th class="text-center">操作</th></tr></thead>
                    <tbody>
                        ${pendingDividends.length > 0 ? pendingDividends.map((p, index) => {
                            const isStaged = stagedPendingIds.has(`${p.symbol}|${p.ex_dividend_date}`);
                            return `<tr class="${isStaged ? 'opacity-50' : ''}">
                                <td class="fw-bold">${p.symbol}</td>
                                <td>${p.ex_dividend_date}</td>
                                <td>${formatNumber(p.quantity_at_ex_date, isTwStock(p.symbol) ? 0 : 2)}</td>
                                <td>${formatNumber(p.amount_per_share, 4)} <span class="text-muted small">${p.currency}</span></td>
                                <td class="text-center">
                                    <button data-index="${index}" class="btn btn-sm btn-outline-primary confirm-dividend-btn" ${isStaged ? 'disabled' : ''}>確認入帳</button>
                                </td>
                            </tr>`;
                        }).join('') : `<tr><td colspan="5" class="text-center py-5 text-muted">沒有待處理的配息。</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>`;

    // 3. 準備「已確認配息」的資料
    const combinedConfirmed = [
        ...confirmedDividends.map(c => stagedUpdates.has(c.id) ? { ...c, ...stagedUpdates.get(c.id) } : c),
        ...stagedCreates
    ].sort((a, b) => new Date(b.pay_date || b.date) - new Date(a.pay_date || a.date));

    const filteredConfirmed = dividendFilter === 'all' || !dividendFilter
        ? combinedConfirmed
        : combinedConfirmed.filter(c => c.symbol.toLowerCase().includes(dividendFilter.toLowerCase()));

    // 4. 渲染「已確認配息」表格
    const confirmedHtml = `
        <div>
            <h3 class="h5 mb-3">已確認 / 歷史配息</h3>
            <!-- Filter UI here -->
            <div class="table-responsive">
                <table class="table table-hover align-middle">
                    <thead><tr><th>發放日</th><th>代碼</th><th>實收總額</th><th class="text-center">操作</th></tr></thead>
                    <tbody>
                        ${filteredConfirmed.length > 0 ? filteredConfirmed.map((c) => {
                            let rowClass = '';
                            let isDeleted = false;
                            if (stagedDeletes.has(c.id)) {
                                rowClass = 'table-danger opacity-75';
                                isDeleted = true;
                            } else if (stagedUpdates.has(c.id)) {
                                rowClass = 'table-warning';
                            } else if (c.id.startsWith('temp_')) {
                                rowClass = 'table-success';
                            }
                            return `<tr class="${rowClass}">
                                <td>${(c.pay_date || c.date).split('T')[0]}</td>
                                <td class="fw-bold">${c.symbol}</td>
                                <td>${formatNumber(c.total_amount || c.amount, c.currency === 'TWD' ? 0 : 2)} <span class="text-muted small">${c.currency}</span></td>
                                <td class="text-center">
                                    <button data-id="${c.id}" class="btn btn-sm btn-outline-primary edit-dividend-btn me-1" ${isDeleted ? 'disabled' : ''}>編輯</button>
                                    <button data-id="${c.id}" class="btn btn-sm btn-outline-danger delete-dividend-btn" ${isDeleted ? 'disabled' : ''}>刪除</button>
                                </td>
                            </tr>`;
                        }).join('') : `<tr><td colspan="4" class="text-center py-5 text-muted">沒有符合條件的已確認配息紀錄。</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>`;

    container.innerHTML = pendingHtml + confirmedHtml;
}
