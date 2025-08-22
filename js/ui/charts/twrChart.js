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

    /**
     * 【修正】對 TWR 這類的幾何級數，應使用幾何方式 rebase，而非算術減法
     */
    const rebaseSeries = (history) => {
        if (!history || Object.keys(history).length === 0) return [];
        const sortedEntries = Object.entries(history).sort((a, b) => new Date(a[0]) - new Date(b[0]));
        const baseValue = sortedEntries[0][1]; // e.g., 5.0 for 5%
        const baseFactor = 1 + baseValue / 100;
        if (Math.abs(baseFactor) < 1e-9) { // Avoid division by zero
             return sortedEntries.map(([date, value]) => [new Date(date).getTime(), value - baseValue]);
        }
        return sortedEntries.map(([date, value]) => [new Date(date).getTime(), ((1 + value / 100) / baseFactor - 1) * 100]);
    };

    const isShowingFullHistory = Object.keys(twrHistory).length > 0 && Object.keys(twrHistory).length === Object.keys(filteredTwrHistory).length;

    let portfolioData;
    let benchmarkData;

    /**
     * 【修正】確保在顯示完整歷史時，Portfolio 和 Benchmark 的處理邏輯一致 (都不 rebase)
     * 在顯示部分區間時，兩者都進行 rebase
     */
    if (isShowingFullHistory) {
        const sortedPortfolio = Object.entries(filteredTwrHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
        portfolioData = sortedPortfolio.map(([date, value]) => [new Date(date).getTime(), value]);

        const sortedBenchmark = Object.entries(filteredBenchmarkHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
        benchmarkData = sortedBenchmark.map(([date, value]) => [new Date(date).getTime(), value]);
    } else {
        portfolioData = rebaseSeries(filteredTwrHistory);
        benchmarkData = rebaseSeries(filteredBenchmarkHistory);
    }

    // 【核心修改】更新 series 時傳入動態的 seriesName
    twrChart.updateSeries([
        { name: seriesName, data: portfolioData },
        { name: `Benchmark (${benchmarkSymbol || '...'})`, data: benchmarkData }
    ]);
}
