// =========================================================================================
// == TWR 圖表模組 (twrChart.js)
// =========================================================================================

import { getState, setState } from '../../state.js';
import { filterHistoryByDateRange } from '../utils.js';
import { baseChartOptions } from './chart.common.js';

/**
 * 初始化 TWR 圖表
 */
export function initializeTwrChart() {
    const options = {
        ...baseChartOptions,
        chart: {
            ...baseChartOptions.chart,
            type: 'line'
        },
        series: [
            { name: '投資組合', data: [] },
            { name: 'Benchmark', data: [] }
        ],
        yaxis: {
            labels: {
                formatter: (value) => `${(value || 0).toFixed(2)}%`
            }
        },
        tooltip: {
            ...baseChartOptions.tooltip,
            y: {
                formatter: (value) => `${(value || 0).toFixed(2)}%`
            }
        },
        colors: ['#4f46e5', '#f59e0b']
    };
    const twrChart = new ApexCharts(document.querySelector("#twr-chart"), options);
    twrChart.render();
    setState({ twrChart });
}

/**
 * 更新 TWR 圖表的數據
 * @param {string} benchmarkSymbol - Benchmark 的代碼
 * @param {string} seriesName - 要顯示在圖例上的系列名稱
 */
export function updateTwrChart(benchmarkSymbol, seriesName = '投資組合') { // 提供預設值
    const { twrChart, twrHistory, benchmarkHistory, twrDateRange } = getState();
    if (!twrChart) return;

    const filteredTwrHistory = filterHistoryByDateRange(twrHistory, twrDateRange);
    const filteredBenchmarkHistory = filterHistoryByDateRange(benchmarkHistory, twrDateRange);

    const rebaseSeries = (history) => {
        if (!history || Object.keys(history).length === 0) return [];
        const sortedEntries = Object.entries(history).sort((a, b) => new Date(a[0]) - new Date(b[0]));
        const baseValue = sortedEntries[0][1];
        return sortedEntries.map(([date, value]) => [new Date(date).getTime(), value - baseValue]);
    };

    const isShowingFullHistory = Object.keys(twrHistory).length > 0 && Object.keys(twrHistory).length === Object.keys(filteredTwrHistory).length;

    let portfolioData;
    if (isShowingFullHistory) {
        const sortedEntries = Object.entries(filteredTwrHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
        portfolioData = sortedEntries.map(([date, value]) => [new Date(date).getTime(), value]);
    } else {
        portfolioData = rebaseSeries(filteredTwrHistory);
    }

    const rebasedBenchmarkData = rebaseSeries(filteredBenchmarkHistory);

    // 【核心修改】更新 series 時傳入動態的 seriesName
    twrChart.updateSeries([
        { name: seriesName, data: portfolioData },
        { name: `Benchmark (${benchmarkSymbol || '...'})`, data: rebasedBenchmarkData }
    ]);
}
