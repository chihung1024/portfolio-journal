import { state } from '../../state';
import { showDetailsModal } from '../ui/components/detailsModal.ui';
import { renderClosedPositions } from '../ui/components/closedPositions.ui';

/**
 * Initializes event listeners for the closed positions tab, including sorting controls.
 * @param {Array<object>} data - The closed positions data.
 */
export function initializeClosedPositionsEvents(data) {
  // Event listener for each position item to show details
  const positionItems = document.querySelectorAll('#closed-positions-content .position-item');
  positionItems.forEach(item => {
    item.addEventListener('click', () => {
      const symbol = item.dataset.symbol;
      const stockData = data.find(d => d.symbol === symbol);
      if (stockData) {
        showDetailsModal(stockData, true); // true indicates it's a closed position
      }
    });
  });

  // Event listener for sorting by profit
  const sortByProfitBtn = document.getElementById('sort-by-profit-btn');
  if (sortByProfitBtn) {
    sortByProfitBtn.addEventListener('click', () => {
      if (state.closedPositionsSort !== 'profit') {
        state.closedPositionsSort = 'profit';
        renderClosedPositions(data);
      }
    });
  }

  // Event listener for sorting by date
  const sortByDateBtn = document.getElementById('sort-by-date-btn');
  if (sortByDateBtn) {
    sortByDateBtn.addEventListener('click', () => {
      if (state.closedPositionsSort !== 'date') {
        state.closedPositionsSort = 'date';
        renderClosedPositions(data);
      }
    });
  }
}
