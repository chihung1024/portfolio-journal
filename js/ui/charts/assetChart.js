// =========================================================================================
// == 資產成長圖表模組 (assetChart.js)
// == 職責：處理資產成長圖表的初始化與更新。
// =========================================================================================

import { getState, setState } from '../../state.js';
import { formatNumber, filterHistoryByDateRange } from '../utils.js';
import { baseChartOptions } from './chart.common.js';

/**
 * 初始化資產成長圖表
 */
export function initializeAssetChart() {
    const options = {
        ...baseChartOptions,
        series: [{ name: '總資產', data: [] }],
        yaxis: {
            labels: {
                formatter: (value) => formatNumber(value, 0)
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.7,
                opacityTo: 0.3,
                stops: [0, 90, 100]
            }
        },
        colors: ['#4f46e5']
    };
    const chart = new ApexCharts(document.querySelector("#asset-chart"), options);
    chart.render();
    setState({ chart });
}

/**
 * 更新資產成長圖表的數據
 */
export function updateAssetChart() {
    const { chart, portfolioHistory, assetDateRange } = getState();
    if (!chart) return;

    const filteredHistory = filterHistoryByDateRange(portfolioHistory, assetDateRange);
    if (!filteredHistory || Object.keys(filteredHistory).length === 0) {
        chart.updateSeries([{ data: [] }]);
        return;
    }

    const chartData = Object.entries(filteredHistory).map(([date, value]) => [new Date(date).getTime(), value]);
    chart.updateSeries([{ data: chartData }]);
}
