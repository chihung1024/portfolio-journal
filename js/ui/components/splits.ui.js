// =========================================================================================
// == 拆股事件 UI 模組 (splits.ui.js) v2.0 - 整合暫存區
// =========================================================================================

import { getState } from '../../state.js';
import { stagingService } from '../../staging.service.js';

export async function renderSplitsTab() {
    const { userSplits } = getState();
    const container = document.getElementById('splits-tab');
    if (!container) return;

    // 1. 獲取拆股相關的暫存操作
    const stagedActions = (await stagingService.getActions()).filter(a => a.entity === 'SPLIT');
    const stagedCreates = stagedActions.filter(a => a.type === 'CREATE').map(a => a.payload);
    const stagedDeletes = new Set(stagedActions.filter(a => a.type === 'DELETE').map(a => a.payload.id));

    // 2. 結合 state 中的拆股事件與暫存區中的新事件
    const displaySplits = [
        ...userSplits,
        ...stagedCreates
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    // 3. 渲染帶有視覺提示的表格
    const tableHtml = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h3 class="h5 mb-0">拆股事件紀錄</h3>
            <button id="add-split-btn" class="btn btn-primary">新增拆股事件</button>
        </div>
        <div class="table-responsive">
            <table class="table table-hover align-middle">
                <thead class="table-light"><tr><th>日期</th><th>代碼</th><th>拆分比例 (From:To)</th><th class="text-center">操作</th></tr></thead>
                <tbody>
                    ${displaySplits.length > 0 ? displaySplits.map(s => {
                        let rowClass = '';
                        let isDeleted = false;
                        if (stagedDeletes.has(s.id)) {
                            rowClass = 'table-danger opacity-75';
                            isDeleted = true;
                        } else if (s.id.startsWith('temp_')) {
                            rowClass = 'table-success';
                        }
                        return `<tr class="${rowClass}">
                            <td>${s.date.split('T')[0]}</td>
                            <td class="fw-bold">${s.symbol.toUpperCase()}</td>
                            <td>${s.from} : ${s.to}</td>
                            <td class="text-center">
                                <button data-id="${s.id}" class="btn btn-sm btn-outline-danger delete-split-btn" ${isDeleted ? 'disabled' : ''}>刪除</button>
                            </td>
                        </tr>`;
                    }).join('') : `<tr><td colspan="4" class="text-center py-5 text-muted">沒有自定義拆股事件。</td></tr>`}
                </tbody>
            </table>
        </div>`;

    container.innerHTML = tableHtml;
}
