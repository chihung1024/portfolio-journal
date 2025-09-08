// =========================================================================================
// == 檔案：js/ui/dashboard.js (v_arch_cleanup_5_final)
// == 職責：渲染儀表板的核心摘要卡片，並遵循正確的狀態管理與格式化規範
// =========================================================================================

import { getSummary } from '../state.js';
// 【核心修正】: 導入標準化的格式化工具
import { formatCurrency, formatNumber } from './utils.js';

/**
 * 渲染儀表板的摘要卡片
 */
function renderDashboard() {
    const summary = getSummary();
    const container = document.getElementById('dashboard-summary');
    if (!container) return;

    // 處理 summary 為空或不存在的情況
    if (!summary || Object.keys(summary).length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 col-span-full">摘要數據正在載入中...</p>';
        return;
    }

    const {
        marketValueTWD = 0,
        unrealizedPLTWD = 0,
        unrealizedPLPercent = 0,
        realizedPLTWD = 0,
        dailyPLTWD = 0,
        dailyPLPercent = 0,
        twr = 0,
        benchmarkTwr = 0
    } = summary;

    const unrealizedPlClass = unrealizedPLTWD >= 0 ? 'text-green-500' : 'text-red-500';
    const dailyPlClass = dailyPLTWD >= 0 ? 'text-green-500' : 'text-red-500';
    const twrClass = twr >= 0 ? 'text-green-500' : 'text-red-500';
    const dailyChangeSign = dailyPLTWD >= 0 ? '+' : '';

    container.innerHTML = `
        <!-- 當前市值 -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">當前市值 (TWD)</h3>
            <p class="mt-1 text-2xl font-semibold">${formatCurrency(marketValueTWD, 'TWD')}</p>
        </div>

        <!-- 未實現損益 -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">未實現損益 (TWD)</h3>
            <p class="mt-1 text-2xl font-semibold ${unrealizedPlClass}">
                ${formatCurrency(unrealizedPLTWD, 'TWD')}
                <span class="text-base ml-2">(${formatNumber(unrealizedPLPercent * 100)}%)</span>
            </p>
        </div>

        <!-- 已實現損益 -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">已實現損益 (TWD)</h3>
            <p class="mt-1 text-2xl font-semibold">${formatCurrency(realizedPLTWD, 'TWD')}</p>
        </div>
        
        <!-- 當日損益 -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">當日損益 (TWD)</h3>
            <p class="mt-1 text-2xl font-semibold ${dailyPlClass}">
                ${dailyChangeSign}${formatCurrency(dailyPLTWD, 'TWD')}
                <span class="text-base ml-2">(${dailyChangeSign}${formatNumber(dailyPLPercent * 100)}%)</span>
            </p>
        </div>

        <!-- 時間加權報酬率 (TWR) -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">時間加權報酬率 (TWR)</h3>
            <p class="mt-1 text-2xl font-semibold ${twrClass}">${formatNumber(twr * 100)}%</p>
        </div>
        
        <!-- 比較基準 (Benchmark) -->
        <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">比較基準 TWR</h3>
            <p class="mt-1 text-2xl font-semibold">${formatNumber(benchmarkTwr * 100)}%</p>
        </div>
    `;
}

export {
    renderDashboard
};
