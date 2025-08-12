// =========================================================================================
// == 淨利圖表模組 (netProfitChart.js)
// == 職責：處理累積淨利走勢圖表的初始化與更新。
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
 */
export function updateNetProfitChart() {
    const { netProfitChart, netProfitHistory, netProfitDateRange } = getState();
    if (!netProfitChart) return;

    const filteredHistory = filterHistoryByDateRange(netProfitHistory, netProfitDateRange);
    if (!filteredHistory || Object.keys(filteredHistory).length === 0) {
        netProfitChart.updateSeries([{ data: [] }]);
        return;
    }

    const sortedEntries = Object.entries(filteredHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    
    // 【修正】移除歸零化邏輯，直接使用絕對值繪圖
    const chartData = sortedEntries.map(([date, value]) => [
        new Date(date).getTime(),
        value // 直接使用後端計算出的原始累積淨利值
    ]);

    netProfitChart.updateSeries([{ data: chartData }]);
}
