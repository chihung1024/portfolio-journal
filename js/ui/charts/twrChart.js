// =========================================================================================
// == TWR 圖表模組 (twrChart.js) v2.2.0 - Unified Rebasing Logic
// == 職責：處理時間加權報酬率圖表的 UI 渲染與區間基準點校正。
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
export function updateTwrChart(benchmarkSymbol, seriesName = '投資組合') {
    const { twrChart, twrHistory, benchmarkHistory, twrDateRange } = getState();
    if (!twrChart) return;

    const filteredTwrHistory = filterHistoryByDateRange(twrHistory, twrDateRange);
    const filteredBenchmarkHistory = filterHistoryByDateRange(benchmarkHistory, twrDateRange);

    /**
     * 【核心修改】統一的基準點校正與格式化函式。
     * 此函式現在會以篩選區間的「前一天」為基準點，進行幾何級數的校正。
     * @param {object} filteredHistory - 已根據日期範圍篩選過的歷史數據
     * @param {object} fullHistory - 完整的、未經篩選的歷史數據
     * @returns {Array} - 格式化後可直接用於 ApexCharts 的數據陣列
     */
    const rebaseAndFormat = (filteredHistory, fullHistory) => {
        if (!filteredHistory || Object.keys(filteredHistory).length === 0) {
            return [];
        }

        const sortedEntries = Object.entries(filteredHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));

        // 1. 找到篩選後區間的第一天
        const firstDateInRangeStr = sortedEntries[0][0];

        // 2. 計算出區間前一天的日期
        const dayBeforeRange = new Date(firstDateInRangeStr);
        dayBeforeRange.setDate(dayBeforeRange.getDate() - 1);
        const dayBeforeRangeStr = dayBeforeRange.toISOString().split('T')[0];

        // 3. 從【未經篩選的】完整歷史數據中，尋找前一天的值作為基線。
        //    若找不到 (代表選取區間已包含歷史起點)，則基線為 0。
        const baseValue = fullHistory[dayBeforeRangeStr] || 0;
        const baseFactor = 1 + baseValue / 100;

        // 4. 進行幾何級數校正 (rebase)
        //    公式：(目前週期報酬率 / 基準週期報酬率) - 1
        if (Math.abs(baseFactor) < 1e-9) { // 避免除以零
            // 若基線報酬接近 -100%，則退回算術減法
            return sortedEntries.map(([date, value]) => [new Date(date).getTime(), value - baseValue]);
        }
        
        return sortedEntries.map(([date, value]) => [
            new Date(date).getTime(),
            ((1 + value / 100) / baseFactor - 1) * 100
        ]);
    };

    const portfolioData = rebaseAndFormat(filteredTwrHistory, twrHistory);
    const benchmarkData = rebaseAndFormat(filteredBenchmarkHistory, benchmarkHistory);

    twrChart.updateSeries([
        { name: seriesName, data: portfolioData },
        { name: `Benchmark (${benchmarkSymbol || '...'})`, data: benchmarkData }
    ]);
}
