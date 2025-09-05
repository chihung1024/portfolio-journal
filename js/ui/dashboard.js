// js/ui/dashboard.js

import { renderTwrChart } from './charts/twrChart.js';
import { renderNetProfitChart } from './charts/netProfitChart.js';
import { renderAssetDistributionChart } from './charts/assetChart.js';
import { formatCurrency, formatPercentage } from './utils.js';

export function renderPortfolioSummary(summary) {
    if (!summary) return;
    
    document.getElementById('total-value').textContent = formatCurrency(summary.totalValue);
    document.getElementById('total-cost').textContent = formatCurrency(summary.totalCost);

    const unrealizedProfitElement = document.getElementById('unrealized-profit');
    unrealizedProfitElement.textContent = formatCurrency(summary.unrealizedProfit, true);
    unrealizedProfitElement.className = summary.unrealizedProfit >= 0 ? 'text-positive' : 'text-negative';

    const roiElement = document.getElementById('unrealized-roi');
    roiElement.textContent = formatPercentage(summary.unrealizedRoi);
    roiElement.className = summary.unrealizedRoi >= 0 ? 'text-positive' : 'text-negative';

    document.getElementById('realized-profit').textContent = formatCurrency(summary.realizedProfit);
    document.getElementById('total-dividends').textContent = formatCurrency(summary.totalDividends);
    document.getElementById('total-transactions').textContent = summary.totalTransactions.toLocaleString();
    document.getElementById('holding-symbols').textContent = summary.holdingSymbols;
}

export { renderTwrChart, renderNetProfitChart, renderAssetDistributionChart };
