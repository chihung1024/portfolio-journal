// =========================================================================================
// == 淨利圖表模組 (netProfitChart.js)
// =========================================================================================

import { getState, setState } from '../../state.js';
import { formatNumber, filterHistoryByDateRange } from '../utils.js';
import { baseChartOptions } from './chart.common.js';

/**
 * 初始化淨利圖表
 */
export function initializeNetProfitChart() {
    const options = {
        ...baseChartOptions,
        series: [{ name: '累積淨利', data: [] }],
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
        tooltip: {
            ...baseChartOptions.tooltip,
            y: {
                formatter: (value) => `TWD ${formatNumber(value, 0)}`
            }
        },
        colors: ['#10b981']
    };
    const netProfitChart = new ApexCharts(document.querySelector("#net-profit-chart"), options);
    netProfitChart.render();
    setState({ netProfitChart });
}

/**
 * 更新淨利圖表的數據
 * @param {string} seriesName - 要顯示在圖例上的系列名稱
 */
export function updateNetProfitChart(seriesName = '累積淨利') { // 提供預設值
    const { netProfitChart, netProfitHistory, netProfitDateRange } = getState();
    if (!netProfitChart) return;

    const filteredHistory = filterHistoryByDateRange(netProfitHistory, netProfitDateRange);
    if (!filteredHistory || Object.keys(filteredHistory).length === 0) {
        netProfitChart.updateSeries([{ data: [] }]);
        return;
    }

    const sortedEntries = Object.entries(filteredHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    
    const baseValue = sortedEntries[0][1];
    const chartData = sortedEntries.map(([date, value]) => [
        new Date(date).getTime(),
        value - baseValue
    ]);

    // 【核心修改】更新 series 時同時更新 name 和 data
    netProfitChart.updateSeries([{ name: seriesName, data: chartData }]);
}
