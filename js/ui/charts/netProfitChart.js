// =========================================================================================
// == 淨利圖表模組 (netProfitChart.js) - v2.0 (Precision Rebasing Logic)
// == 職責：處理累積淨利走勢圖的渲染，並根據用戶選擇的時間範圍，智能地應用精準 Rebasing。
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
 * 更新淨利圖表的數據，實現智能 Rebasing
 * @param {string} seriesName - 要顯示在圖例上的系列名稱
 */
export function updateNetProfitChart(seriesName = '累積淨利') {
    const { netProfitChart, netProfitHistory, netProfitDateRange } = getState();
    if (!netProfitChart) return;

    // 1. 根據用戶選擇的時間範圍，篩選出需要顯示的歷史數據
    const filteredHistory = filterHistoryByDateRange(netProfitHistory, netProfitDateRange);

    if (!filteredHistory || Object.keys(filteredHistory).length === 0) {
        netProfitChart.updateSeries([{ data: [] }]);
        return;
    }

    const allHistoryEntries = Object.entries(netProfitHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    const filteredEntries = Object.entries(filteredHistory).sort((a, b) => new Date(a[0]) - new Date(b[0]));

    let chartData;
    
    // ========================= 【核心修改 - 開始】 =========================
    // 2. 判斷是否需要 Rebasing
    // 只有當用戶選擇的不是 'all' (即選擇了特定時間區間) 且區間內有數據時，才進行 Rebasing
    if (netProfitDateRange.type !== 'all' && filteredEntries.length > 0) {
        // 智慧 Rebasing 邏輯
        const firstDateInFilter = filteredEntries[0][0];
        
        // 尋找篩選區間前一天的索引
        const dayBeforeIndex = allHistoryEntries.findIndex(([date]) => date === firstDateInFilter) - 1;

        // 如果找到了前一天 (即 dayBeforeIndex >= 0)，則用前一天的值作為基線
        // 如果找不到 (例如，選擇的區間包含了第一筆數據)，則基線為 0
        const baseValue = (dayBeforeIndex >= 0) ? allHistoryEntries[dayBeforeIndex][1] : 0;
        
        // 從區間內每一天的數據中減去基線值
        chartData = filteredEntries.map(([date, value]) => [
            new Date(date).getTime(),
            value - baseValue
        ]);

    } else {
        // 全局視圖 ('all')：不進行 Rebasing，顯示絕對的累積淨利
        chartData = filteredEntries.map(([date, value]) => [
            new Date(date).getTime(),
            value
        ]);
    }
    // ========================= 【核心修改 - 結束】 =========================

    // 3. 更新圖表
    netProfitChart.updateSeries([{ name: seriesName, data: chartData }]);
}
