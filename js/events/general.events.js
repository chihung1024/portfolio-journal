// js/events/general.events.js

import { getHoldings } from '../api.js';
import { renderHoldingsTable } from '../ui/components/holdings.ui.js';
import { renderPortfolioSummary, renderAssetDistributionChart, renderNetProfitChart, renderTwrChart } from '../ui/dashboard.js';
import state from '../state.js';

export function setupGeneralEventListeners() {
    const refreshDataBtn = document.getElementById('refresh-data-btn');
    if (refreshDataBtn) {
        refreshDataBtn.addEventListener('click', async () => {
            console.log('Refreshing data...');
            await getHoldings();
            
            // Re-render all relevant components
            renderPortfolioSummary(state.portfolioSummary);
            renderHoldingsTable();
            renderAssetDistributionChart(state.chartData.assetDistribution);
            renderNetProfitChart(state.chartData);
            renderTwrChart(state.chartData);
            
            console.log('Data refreshed.');
        });
    }

    const holdingsTable = document.getElementById('holdings-table');
    if(holdingsTable) {
        holdingsTable.addEventListener('click', (event) => {
            const sortButton = event.target.closest('[data-sort-key]');
            if (sortButton) {
                const key = sortButton.dataset.sortKey;
                if (state.holdingsSort.key === key) {
                    state.holdingsSort.order = state.holdingsSort.order === 'asc' ? 'desc' : 'asc';
                } else {
                    state.holdingsSort.key = key;
                    state.holdingsSort.order = 'desc'; // Default to descending for new key
                }
                renderHoldingsTable();
            }
        });
    }
}
