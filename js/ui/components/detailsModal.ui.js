// =========================================================================================
// == 檔案：js/ui/components/detailsModal.ui.js (v_arch_cleanup_2)
// == 職責：渲染持股詳情的彈出視窗，並遵循正確的狀態管理與格式化規範
// =========================================================================================

import { getHoldings } from '../../state.js';
// 【核心修正】: 移除對不存在函式的導入，改為導入標準化的格式化工具
import { formatCurrency, formatNumber } from '../utils.js';

/**
 * 渲染持股詳情彈窗的內容
 * @param {string} symbol - 要顯示詳情的股票代碼
 */
function renderDetailsModalContent(symbol) {
    const holdings = getHoldings();
    const holding = holdings.find(h => h.symbol === symbol);
    const modalBody = document.getElementById('details-modal-body');
    const modalTitle = document.getElementById('details-modal-title');

    if (!modalBody || !modalTitle) return;

    if (!holding) {
        modalTitle.textContent = '錯誤';
        modalBody.innerHTML = `<p>找不到代碼為 ${symbol} 的持股資訊。</p>`;
        return;
    }

    modalTitle.textContent = `持股詳情: ${holding.symbol}`;

    const plClass = holding.unrealizedPLTWD >= 0 ? 'text-green-500' : 'text-red-500';

    modalBody.innerHTML = `
        <div class="space-y-4">
            <div>
                <h3 class="font-semibold text-lg mb-2">核心指標</h3>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">持有股數</p>
                        <p class="font-semibold text-base">${formatNumber(holding.quantity, { maximumFractionDigits: 4 })}</p>
                    </div>
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">平均成本 (TWD)</p>
                        <p class="font-semibold text-base">${formatCurrency(holding.totalCostTWD / holding.quantity, 'TWD')}</p>
                    </div>
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">總成本 (TWD)</p>
                        <p class="font-semibold text-base">${formatCurrency(holding.totalCostTWD, 'TWD')}</p>
                    </div>
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">當前市值 (TWD)</p>
                        <p class="font-semibold text-base">${formatCurrency(holding.marketValueTWD, 'TWD')}</p>
                    </div>
                </div>
            </div>

            <div>
                <h3 class="font-semibold text-lg mb-2">損益分析</h3>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">未實現損益 (TWD)</p>
                        <p class="font-semibold text-base ${plClass}">${formatCurrency(holding.unrealizedPLTWD, 'TWD')}</p>
                    </div>
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">報酬率</p>
                        <p class="font-semibold text-base ${plClass}">${formatNumber(holding.returnRate * 100)}%</p>
                    </div>
                     <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">已實現損益 (TWD)</p>
                        <p class="font-semibold text-base">${formatCurrency(holding.realizedPLTWD, 'TWD')}</p>
                    </div>
                </div>
            </div>
            
            <div>
                <h3 class="font-semibold text-lg mb-2">原始貨幣資訊</h3>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">平均成本 (${holding.currency})</p>
                        <p class="font-semibold text-base">${formatCurrency(holding.avgCostOriginal, holding.currency)}</p>
                    </div>
                    <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        <p class="text-gray-500 dark:text-gray-400">當前價格 (${holding.currency})</p>
                        <p class="font-semibold text-base">${formatCurrency(holding.currentPriceOriginal, holding.currency)}</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export { renderDetailsModalContent };
