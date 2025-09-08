// =========================================================================================
// == 檔案：js/ui/charts/assetChart.js (v_chart_refactor_3)
// == 職責：作為一個純粹的渲染組件，負責接收預處理數據並繪製資產歷史圖表
// =========================================================================================

import { chartColors, commonChartOptions, CHART_INSTANCE_MAP } from './chart.common.js';
import { formatCurrency } from '../utils.js';

/**
 * 渲染資產淨值歷史圖表
 * @param {object} historyData - 由邏輯協調器 (general.events.js) 傳入的、已過濾的歷史數據
 */
function renderAssetChart(historyData) {
    const canvas = document.getElementById('asset-chart');
    if (!canvas) return;
    
    // 【核心重構】: 移除所有內部數據獲取與過濾邏輯。
    // 此組件現在完全依賴傳入的 `historyData` 參數，實現了職責分離。

    if (CHART_INSTANCE_MAP.assetChart) {
        CHART_INSTANCE_MAP.assetChart.destroy();
    }
    
    if (!historyData || Object.keys(historyData).length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const labels = Object.keys(historyData);
    const data = Object.values(historyData);

    const chartData = {
        labels: labels,
        datasets: [{
            label: '資產淨值 (TWD)',
            data: data,
            borderColor: chartColors.blue,
            backgroundColor: 'rgba(54, 162, 235, 0.2)',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.1,
            fill: true,
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
                    callback: function(value, index, values) {
                        return formatCurrency(value, 'TWD');
                    }
                }
            },
            x: {
                 ...commonChartOptions.scales.x,
            }
        }
    };

    CHART_INSTANCE_MAP.assetChart = new Chart(canvas, {
        type: 'line',
        data: chartData,
        options: options
    });
}

export { renderAssetChart };
