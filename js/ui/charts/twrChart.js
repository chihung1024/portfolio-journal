// =========================================================================================
// == 檔案：js/ui/charts/twrChart.js (v_chart_refactor_4)
// == 職責：作為一個純粹的渲染組件，負責接收預處理數據並繪製 TWR 與比較基準圖表
// =========================================================================================

import { chartColors, commonChartOptions, CHART_INSTANCE_MAP } from './chart.common.js';
import { formatNumber } from '../utils.js';

/**
 * 渲染時間加權報酬率 (TWR) 圖表
 * @param {object} twrHistory - 由邏輯協調器傳入的、已過濾的 TWR 歷史數據
 * @param {object} benchmarkHistory - 由邏輯協調器傳入的、已過濾的比較基準歷史數據
 */
function renderTwrChart(twrHistory, benchmarkHistory) {
    const canvas = document.getElementById('twr-chart');
    if (!canvas) return;

    // 【核心重構】: 移除所有內部數據獲取與過濾邏輯。
    if (CHART_INSTANCE_MAP.twrChart) {
        CHART_INSTANCE_MAP.twrChart.destroy();
    }

    if (!twrHistory || Object.keys(twrHistory).length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const labels = Object.keys(twrHistory);
    const twrData = Object.values(twrHistory).map(v => v * 100);
    
    // 確保 benchmarkHistory 的 keys 與 twrHistory 對齊
    const benchmarkData = labels.map(label => (benchmarkHistory && benchmarkHistory[label] !== undefined) ? benchmarkHistory[label] * 100 : null);

    const chartData = {
        labels: labels,
        datasets: [{
            label: '時間加權報酬率 (TWR)',
            data: twrData,
            borderColor: chartColors.green,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.1,
            fill: false,
        }, {
            label: '比較基準 (Benchmark)',
            data: benchmarkData,
            borderColor: chartColors.gray,
            borderWidth: 2,
            borderDash: [5, 5], // 虛線
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.1,
            fill: false,
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
                            label += formatNumber(context.parsed.y) + '%';
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
                        return value + '%';
                    }
                }
            },
            x: {
                ...commonChartOptions.scales.x,
            }
        }
    };

    CHART_INSTANCE_MAP.twrChart = new Chart(canvas, {
        type: 'line',
        data: chartData,
        options: options
    });
}

export { renderTwrChart };
