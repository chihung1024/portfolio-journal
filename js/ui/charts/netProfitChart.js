// =========================================================================================
// == 淨利圖表模組 (netProfitChart.js) - v5.0 (Architecture Refactor)
// == 描述：v5.0 架構重構，改為在客戶端(Client-side)累加每日損益快照來生成圖表。
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
    // 【v5.0 修改】數據源從 netProfitHistory 改為 dailyPLSnapshots
    const { netProfitChart, dailyPLSnapshots, netProfitDateRange } = getState();
    if (!netProfitChart) return;

    // 【v5.0 修改】篩選器現在作用於每日損益數據上
    const filteredDailyPL = filterHistoryByDateRange(dailyPLSnapshots, netProfitDateRange);
    if (!filteredDailyPL || Object.keys(filteredDailyPL).length === 0) {
        netProfitChart.updateSeries([{ name: seriesName, data: [] }]);
        return;
    }

    // ========================= 【v5.0 核心修改 - 開始】 =========================
    // == 新增：在前端進行客戶端累加 (Client-side Accumulation)
    // =========================================================================================
    const sortedDates = Object.keys(filteredDailyPL).sort();
    const chartData = [];
    let cumulativeProfit = 0;

    for (const dateStr of sortedDates) {
        cumulativeProfit += filteredDailyPL[dateStr];
        chartData.push([
            new Date(dateStr).getTime(),
            cumulativeProfit
        ]);
    }

    // ========================= 【v5.0 核心修改 - 結束】 =========================

    // 【v5.0 修改】移除舊的 rebase 邏輯，因為累加是從 0 開始的，天然地實現了 rebase 效果
    netProfitChart.updateSeries([{ name: seriesName, data: chartData }]);
}
