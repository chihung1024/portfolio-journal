// js/ui/components/closedPositions.ui.js

import state from '../../state.js';
import { formatCurrency, formatPercentage } from '../utils.js';

function getSortIndicator(key) {
    if (state.closedPositionsSort.key === key) {
        return state.closedPositionsSort.order === 'asc' ? ' ▲' : ' ▼';
    }
    return '';
}

function renderClosedPositionsHeader() {
    return `
        <div class="table-toolbar">
            <div class="table-title">已實現損益</div>
        </div>
        <div class="sort-controls">
            <span>排序依：</span>
            <button class="sort-button" data-key="exitDate">平倉日期${getSortIndicator('exitDate')}</button>
            <button class="sort-button" data-key="realizedProfit">損益金額${getSortIndicator('realizedProfit')}</button>
        </div>
    `;
}

export function renderClosedPositionsTable() {
    const closedPositions = state.closedPositions || [];
    const container = document.getElementById('closed-positions-table');
    if (!container) {
        console.error("renderClosedPositionsTable: container 'closed-positions-table' not found");
        return;
    }

    // Sort the closed positions
    const sortedPositions = [...closedPositions].sort((a, b) => {
        const { key, order } = state.closedPositionsSort;
        if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
            return 0;
        }

        let aValue = a[key];
        let bValue = b[key];

        // Handle date strings
        if (key === 'exitDate') {
            aValue = new Date(aValue);
            bValue = new Date(bValue);
        }

        if (aValue < bValue) {
            return order === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
            return order === 'asc' ? 1 : -1;
        }
        return 0;
    });

    const headerHTML = renderClosedPositionsHeader();
    const tableHTML = `
        <div class="holding-cards-container">
            ${sortedPositions.map(position => `
                <div class="holding-card">
                    <div class="card-header">
                        <div class="symbol">${position.symbol}</div>
                        <div class="name">${position.name}</div>
                    </div>
                    <div class="card-body">
                        <div class="card-row">
                            <div class="label">平倉日期</div>
                            <div class="value">${position.exitDate}</div>
                        </div>
                        <div class="card-row">
                            <div class="label">持有天數</div>
                            <div class="value">${position.holdingDays} 天</div>
                        </div>
                        <div class="card-row">
                            <div class="label">平均買價</div>
                            <div class="value">${formatCurrency(position.averageCost)}</div>
                        </div>
                        <div class="card-row">
                            <div class="label">平均賣價</div>
                            <div class="value">${formatCurrency(position.averageSalePrice)}</div>
                        </div>
                        <div class="card-row">
                            <div class="label">已實現損益</div>
                            <div class="value ${position.realizedProfit > 0 ? 'text-positive' : position.realizedProfit < 0 ? 'text-negative' : ''}">
                                ${formatCurrency(position.realizedProfit)}
                            </div>
                        </div>
                        <div class="card-row">
                            <div class="label">報酬率</div>
                            <div class="value ${position.realizedProfit > 0 ? 'text-positive' : position.realizedProfit < 0 ? 'text-negative' : ''}">
                                ${formatPercentage(position.roi)}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    if (sortedPositions.length === 0) {
        container.innerHTML = `${headerHTML}<p>沒有已實現損益的資料。</p>`;
    } else {
        container.innerHTML = headerHTML + tableHTML;
    }
}
