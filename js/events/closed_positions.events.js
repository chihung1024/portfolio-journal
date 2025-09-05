// js/events/closed_positions.events.js

import { getClosedPositions } from '../api.js';
import { renderClosedPositionsTable } from '../ui/components/closedPositions.ui.js';
import state from '../state.js';

export function setupClosedPositionsEventListeners() {
    const closedPositionsTab = document.getElementById('closed-positions-tab');
    if (closedPositionsTab) {
        closedPositionsTab.addEventListener('click', async () => {
            await getClosedPositions();
            renderClosedPositionsTable();
        });
    }

    // Event delegation for sort buttons
    const closedPositionsContainer = document.getElementById('closed-positions-content');
    if (closedPositionsContainer) {
        closedPositionsContainer.addEventListener('click', (event) => {
            const target = event.target;
            if (target.matches('.sort-button')) {
                const key = target.dataset.key;
                if (state.closedPositionsSort.key === key) {
                    state.closedPositionsSort.order = state.closedPositionsSort.order === 'asc' ? 'desc' : 'asc';
                } else {
                    state.closedPositionsSort.key = key;
                    state.closedPositionsSort.order = 'desc';
                }
                renderClosedPositionsTable();
            }
        });
    }
}
