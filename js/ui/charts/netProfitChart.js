// =========================================================================================
// == 淨利圖表模組 (netProfitChart.js) - v2.1 (Robust View Detection)
// == 職責：處理累積淨利走勢圖的渲染，並採用更穩健的邏輯來決定是否應用 Rebasing。
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
 * 更新淨利圖表的數據，實現智能且穩健的 Rebasing
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

    const allHistoryEntries = Object.entries(netProfitHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    const filteredEntries = Object.entries(filteredHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));

    let chartData;

    // ========================= 【核心修改 - 開始】 =========================
    // 採用更穩健的 Rebasing 判斷邏輯：
    // 比較原始歷史數據的長度和篩選後數據的長度。
    // 只有當兩者長度不同時（代表用戶查看的是一個子集，而非全部歷史），才啟用 Rebasing。
    const isShowingFullHistory = allHistoryEntries.length === filteredEntries.length;

    if (!isShowingFullHistory && filteredEntries.length > 0) {
        // 區間視圖：啟用精準 Rebasing
        const firstDateInFilter = filteredEntries[0][0];
        const dayBeforeIndex = allHistoryEntries.findIndex(([date]) => date === firstDateInFilter) - 1;
        const baseValue = (dayBeforeIndex >= 0) ? allHistoryEntries[dayBeforeIndex][1] : 0;
        
        chartData = filteredEntries.map(([date, value]) => [
            new Date(date).getTime(),
            value - baseValue
        ]);

    } else {
        // 全局視圖 ('全部')：不進行 Rebasing，顯示絕對值
        chartData = filteredEntries.map(([date, value]) => [
            new Date(date).getTime(),
            value
        ]);
    }
    // ========================= 【核心修改 - 結束】 =========================

    netProfitChart.updateSeries([{ name: seriesName, data: chartData }]);
}
