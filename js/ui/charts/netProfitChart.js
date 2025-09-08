// =========================================================================================
// == 淨利圖表模組 (netProfitChart.js) v2.1.0 (Accurate Interval Rebasing)
// == 職責：處理累積淨利圖表的 UI 渲染與區間相對化。
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
export function updateNetProfitChart(seriesName = '累積淨利') {
    const { netProfitChart, netProfitHistory, netProfitDateRange } = getState();
    if (!netProfitChart) return;

    const filteredHistory = filterHistoryByDateRange(netProfitHistory, netProfitDateRange);
    if (!filteredHistory || Object.keys(filteredHistory).length === 0) {
        netProfitChart.updateSeries([{ data: [] }]);
        return;
    }

    const sortedEntries = Object.entries(filteredHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    
    // ========================= 【核心修改 - 開始】 =========================
    // 1. 找到篩選後區間的第一天
    const firstDateInRangeStr = sortedEntries[0][0];
    const firstDateInRange = new Date(firstDateInRangeStr);

    // 2. 計算出區間前一天的日期
    const dayBeforeRange = new Date(firstDateInRange);
    dayBeforeRange.setDate(dayBeforeRange.getDate() - 1);
    const dayBeforeRangeStr = dayBeforeRange.toISOString().split('T')[0];

    // 3. 從【未經篩選的】完整歷史數據中，尋找前一天的值作為基線
    //    如果找不到 (代表選取區間已包含歷史起點)，則基線為 0。
    const baseValue = netProfitHistory[dayBeforeRangeStr] || 0;
    
    // 4. 所有圖表上的點都減去這個基線值，確保區間第一天的損益能被如實呈現
    const chartData = sortedEntries.map(([date, value]) => [
        new Date(date).getTime(),
        value - baseValue
    ]);
    // ========================= 【核心修改 - 結束】 =========================

    netProfitChart.updateSeries([{ name: seriesName, data: chartData }]);
}
