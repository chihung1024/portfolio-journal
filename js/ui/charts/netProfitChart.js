// =========================================================================================
// == 檔案：js/ui/charts/netProfitChart.js (v_chart_refactor_5_final)
// == 職責：作為一個純粹的渲染組件，負責接收預處理數據並繪製淨利歷史圖表
// =========================================================================================

import { chartColors, commonChartOptions, CHART_INSTANCE_MAP } from './chart.common.js';
import { formatCurrency } from '../utils.js';

/**
 * 渲染淨利歷史圖表
 * @param {object} historyData - 由邏輯協調器 (general.events.js) 傳入的、已過濾的歷史數據
 */
function renderNetProfitChart(historyData) {
    const canvas = document.getElementById('net-profit-chart');
    if (!canvas) return;

    // 【核心重構】: 移除所有內部數據獲取與過濾邏輯。
    if (CHART_INSTANCE_MAP.netProfitChart) {
        CHART_INSTANCE_MAP.netProfitChart.destroy();
    }

    if (!historyData || Object.keys(historyData).length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const labels = Object.keys(historyData);
    const data = Object.values(historyData);

    // 根據數據是正或負，決定長條圖的顏色
    const backgroundColors = data.map(value => value >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)');
    const borderColors = data.map(value => value >= 0 ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)');

    const chartData = {
        labels: labels,
        datasets: [{
            label: '淨利 (TWD)',
            data: data,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 1
        }]
    };

    const options = {
        ...commonChartOptions,
        plugins: {
            ...commonChartOptions.plugins,
            tooltip: {
                ...commonChartOptions.plugins.tooltip,
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null) {
                            label += formatCurrency(context.parsed.y, 'TWD');
                        }
                        return label;
                    }
                }
            }
        },
        scales: {
            y: {
                ...commonChartOptions.scales.y,
                ticks: {
                    ...commonChartOptions.scales.y.ticks,
                    callback: function(value) {
                        return formatCurrency(value, 'TWD');
                    }
                }
            },
            x: {
                ...commonChartOptions.scales.x,
            }
        }
    };

    CHART_INSTANCE_MAP.netProfitChart = new Chart(canvas, {
        type: 'bar', // 淨利圖表使用長條圖
        data: chartData,
        options: options
    });
}

export { renderNetProfitChart };
