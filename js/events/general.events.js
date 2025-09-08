// =========================================================================================
// == 檔案：js/events/general.events.js (v_chart_refactor_2)
// == 職責：處理通用 UI 事件，並作為「邏輯協調器」統一處理圖表數據的過濾與分發
// =========================================================================================

import { getSummary } from '../state.js';
import { filterHistoryByDateRange } from '../ui/utils.js';
import { renderAssetChart } from '../ui/charts/assetChart.js';
import { renderTwrChart } from '../ui/charts/twrChart.js';
import { renderNetProfitChart } from '../ui/charts/netProfitChart.js';

let activeRange = 'ALL'; // 預設選取的日期範圍

/**
 * 更新所有圖表
 * @param {string} range - 日期範圍 ('1M', '6M', 'YTD', '1Y', 'ALL')
 */
function updateAllCharts(range) {
    const summary = getSummary();
    if (!summary || !summary.history) return;

    // 【核心重構】: 數據過濾邏輯被集中在此處，統一處理
    const filteredAssetHistory = filterHistoryByDateRange(summary.history, range);
    const filteredTwrHistory = filterHistoryByDateRange(summary.twrHistory, range);
    const filteredBenchmarkHistory = filterHistoryByDateRange(summary.benchmarkHistory, range);
    const filteredNetProfitHistory = filterHistoryByDateRange(summary.netProfitHistory, range);

    // 將已過濾的數據分發給各自的、純粹的渲染組件
    renderAssetChart(filteredAssetHistory);
    renderTwrChart(filteredTwrHistory, filteredBenchmarkHistory);
    renderNetProfitChart(filteredNetProfitHistory);
}


/**
 * 初始化通用事件監聽器，特別是圖表日期範圍選擇器
 */
function initializeGeneralEventListeners() {
    const chartRangeContainer = document.getElementById('chart-range-selector');
    if (!chartRangeContainer) return;

    chartRangeContainer.addEventListener('click', (event) => {
        const button = event.target.closest('.range-btn');
        if (!button) return;

        // 移除其他按鈕的 'active' 狀態
        chartRangeContainer.querySelectorAll('.range-btn').forEach(btn => {
            btn.classList.remove('bg-blue-600', 'text-white');
            btn.classList.add('bg-gray-200', 'dark:bg-gray-700');
        });

        // 為當前點擊的按鈕添加 'active' 狀態
        button.classList.add('bg-blue-600', 'text-white');
        button.classList.remove('bg-gray-200', 'dark:bg-gray-700');

        activeRange = button.dataset.range;
        updateAllCharts(activeRange);
    });

    // 監聽全局狀態更新，例如在首次載入數據後
    document.addEventListener('state-updated', () => {
         // 在每次數據更新後，使用當前選取的範圍重新渲染圖表
        updateAllCharts(activeRange);
    });
}

export { initializeGeneralEventListeners };
