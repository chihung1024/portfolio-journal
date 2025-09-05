import { state } from '../../state';
import { formatNumber, formatPercentage } from '../utils';
import { initializeClosedPositionsEvents } from '../../events/closed_positions.events';

/**
 * Renders the closed positions tab with data.
 * @param {Array<object>} data - The closed positions data.
 */
export function renderClosedPositions(data) {
  const container = document.getElementById('closed-positions-content');
  if (!container) {
    console.error('Closed positions container not found');
    return;
  }

  // Sort the data based on the current state
  if (state.closedPositionsSort === 'profit') {
    data.sort((a, b) => b.unrealizedProfit - a.unrealizedProfit);
  } else if (state.closedPositionsSort === 'date') {
    data.sort((a, b) => new Date(b.lastTransactionDate) - new Date(a.lastTransactionDate));
  }

  let contentHTML = `
    <div class="closed-positions-header">
      <h2>已實現標的</h2>
      <div class="sort-controls">
        <span>排序依：</span>
        <button id="sort-by-profit-btn" class="button ${state.closedPositionsSort === 'profit' ? 'active' : ''}">盈虧金額</button>
        <button id="sort-by-date-btn" class="button ${state.closedPositionsSort === 'date' ? 'active' : ''}">最近交易</button>
      </div>
    </div>
    <div class="positions-list">
  `;

  if (data.length === 0) {
    contentHTML += '<p class="no-data">沒有已實現的標的。</p>';
  } else {
    data.forEach(item => {
      const profitClass = item.unrealizedProfit >= 0 ? 'text-profit' : 'text-loss';
      const roi = (item.unrealizedProfit / item.totalCost) * 100;

      contentHTML += `
        <div class="position-item" data-symbol="${item.symbol}">
          <div class="position-item-header">
            <h3 class="symbol">${item.symbol}</h3>
            <div class="market-value ${profitClass}">
              ${formatNumber(item.unrealizedProfit)}
            </div>
          </div>
          <div class="position-item-body">
            <div class="kpi-container">
              <div class="kpi">
                <span class="kpi-label">平均成本</span>
                <span class="kpi-value">${formatNumber(item.averageCost)}</span>
              </div>
              <div class="kpi">
                <span class="kpi-label">總投入成本</span>
                <span class="kpi-value">${formatNumber(item.totalCost)}</span>
              </div>
              <div class="kpi">
                <span class="kpi-label">投資報酬率</span>
                <span class="kpi-value ${profitClass}">${formatPercentage(roi)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    });
  }

  contentHTML += '</div>';
  container.innerHTML = contentHTML;

  // Initialize events for the newly rendered elements
  initializeClosedPositionsEvents(data);
}
