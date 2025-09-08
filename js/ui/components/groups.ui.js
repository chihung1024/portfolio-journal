// =========================================================================================
// == 檔案：js/ui/components/groups.ui.js (v_arch_cleanup_final)
// == 職責：渲染「群組」頁籤的 UI 介面，並遵循正確的狀態管理規範
// =========================================================================================

// 【核心修正】: 移除對不存在的 getState 的導入
import { getGroups, getHoldings } from '../../state.js';
import { formatCurrency, formatNumber } from '../utils.js';

/**
 * 渲染群組列表及其相關數據
 */
function renderGroups() {
    // 【核心修正】: 直接導入並使用具體的 getter 函式
    const groups = getGroups();
    const allHoldings = getHoldings();
    const container = document.getElementById('groups-content');

    if (!container) return;

    if (!groups || groups.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 py-4">您尚未建立任何群組。</p>`;
        return;
    }

    const groupCards = groups.map(group => {
        const groupHoldings = allHoldings.filter(h => group.symbols.includes(h.symbol));
        
        const marketValueTWD = groupHoldings.reduce((sum, h) => sum + h.marketValueTWD, 0);
        const totalCostTWD = groupHoldings.reduce((sum, h) => sum + h.totalCostTWD, 0);
        const unrealizedPLTWD = marketValueTWD - totalCostTWD;
        const returnRate = totalCostTWD === 0 ? 0 : (unrealizedPLTWD / totalCostTWD);
        const dailyPLTWD = groupHoldings.reduce((sum, h) => sum + h.daily_pl_twd, 0);

        const plClass = unrealizedPLTWD >= 0 ? 'text-green-500' : 'text-red-500';
        const dailyPlClass = dailyPLTWD >= 0 ? 'text-green-500' : 'text-red-500';

        return `
            <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                <h3 class="font-semibold text-lg mb-2">${group.name}</h3>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p class="text-gray-500 dark:text-gray-400">市值 (TWD)</p>
                        <p class="font-semibold">${formatCurrency(marketValueTWD, 'TWD')}</p>
                    </div>
                    <div>
                        <p class="text-gray-500 dark:text-gray-400">未實現損益</p>
                        <p class="font-semibold ${plClass}">${formatCurrency(unrealizedPLTWD, 'TWD')}</p>
                    </div>
                    <div>
                        <p class="text-gray-500 dark:text-gray-400">當日損益</p>
                        <p class="font-semibold ${dailyPlClass}">${formatCurrency(dailyPLTWD, 'TWD')}</p>
                    </div>
                    <div>
                        <p class="text-gray-500 dark:text-gray-400">報酬率</p>
                        <p class="font-semibold ${plClass}">${formatNumber(returnRate * 100)}%</p>
                    </div>
                </div>
                <div class="mt-3">
                    <p class="text-xs text-gray-400">包含: ${group.symbols.join(', ')}</p>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${groupCards}
        </div>
    `;
}

export { renderGroups };
