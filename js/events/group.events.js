// =========================================================================================
// == 群組事件處理模組 (group.events.js) v2.0 - 交易選擇器整合
// =========================================================================================

import { apiRequest, executeApiAction } from '../api.js';
import { getState, setState } from '../state.js';
import { showNotification } from '../ui/notifications.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { renderGroupsContent } from '../ui/components/groups.ui.js';
import { stagingService } from '../staging.service.js';

// ========================= 【核心擴展 - 開始】 =========================

/**
 * 【新增】群組交易關聯管理 API 包裝器
 */
export const GroupTransactionManager = {
    /**
     * 批次更新群組包含的交易
     * @param {string} groupId - 群組ID
     * @param {Array<number>} transactionIds - 交易ID陣列
     * @param {string} action - 操作類型: 'set', 'add', 'remove'
     */
    async updateGroupTransactions(groupId, transactionIds, action = 'set') {
        try {
            const result = await executeApiAction('update_group_transactions', {
                groupId,
                transactionIds,
                action
            }, {
                loadingText: '正在更新群組交易...',
                successMessage: '群組交易已更新！',
                shouldRefreshData: false
            });

            if (result) {
                await loadGroups();
                showNotification('success', `成功${action === 'add' ? '新增' : action === 'remove' ? '移除' : '設定'} ${transactionIds.length} 筆交易`);
            }

            return result;
        } catch (error) {
            console.error('更新群組交易失敗:', error);
            showNotification('error', `更新群組交易失敗: ${error.message}`);
            throw error;
        }
    },

    /**
     * 獲取群組的所有交易
     * @param {string} groupId - 群組ID
     */
    async getGroupTransactions(groupId) {
        try {
            const result = await apiRequest('get_group_transactions', { groupId });
            if (result.success) {
                return result.data.transactions || [];
            }
            return [];
        } catch (error) {
            console.error('獲取群組交易失敗:', error);
            showNotification('error', '獲取群組交易失敗');
            return [];
        }
    },

    /**
     * 檢查交易是否被其他群組使用
     * @param {Array<number>} transactionIds - 交易ID陣列
     * @param {string} excludeGroupId - 排除的群組ID
     */
    async checkTransactionConflicts(transactionIds, excludeGroupId = null) {
        try {
            const result = await apiRequest('check_transaction_conflicts', { 
                transactionIds,
                excludeGroupId
            });
            
            if (result.success) {
                return {
                    conflicts: result.data.conflicts || [],
                    conflictIds: result.data.conflictIds || []
                };
            }
            return { conflicts: [], conflictIds: [] };
        } catch (error) {
            console.warn('檢查交易衝突失敗:', error);
            return { conflicts: [], conflictIds: [] };
        }
    },

    /**
     * 批次移動交易到其他群組
     * @param {Array<number>} transactionIds - 交易ID陣列
     * @param {string} fromGroupId - 來源群組ID
     * @param {string} toGroupId - 目標群組ID
     */
    async moveTransactionsToGroup(transactionIds, fromGroupId, toGroupId) {
        try {
            // 先從原群組移除
            await this.updateGroupTransactions(fromGroupId, transactionIds, 'remove');
            
            // 再加入到目標群組
            await this.updateGroupTransactions(toGroupId, transactionIds, 'add');
            
            showNotification('success', `成功移動 ${transactionIds.length} 筆交易到新群組`);
            return true;
        } catch (error) {
            console.error('移動交易失敗:', error);
            showNotification('error', `移動交易失敗: ${error.message}`);
            return false;
        }
    },

    /**
     * 複製交易到其他群組（允許交易存在於多個群組）
     * @param {Array<number>} transactionIds - 交易ID陣列
     * @param {string} toGroupId - 目標群組ID
     */
    async copyTransactionsToGroup(transactionIds, toGroupId) {
        try {
            await this.updateGroupTransactions(toGroupId, transactionIds, 'add');
            showNotification('success', `成功複製 ${transactionIds.length} 筆交易到群組`);
            return true;
        } catch (error) {
            console.error('複製交易失敗:', error);
            showNotification('error', `複製交易失敗: ${error.message}`);
            return false;
        }
    }
};

/**
 * 【新增】智能群組建議功能
 */
export const GroupSuggestionEngine = {
    /**
     * 基於現有交易推薦群組建立
     * @param {Array} transactions - 所有交易記錄
     */
    generateGroupSuggestions(transactions) {
        const suggestions = [];

        // 按股票代碼分組建議
        const symbolGroups = this._groupBySymbol(transactions);
        Object.entries(symbolGroups).forEach(([symbol, txs]) => {
            if (txs.length >= 3) {
                suggestions.push({
                    type: 'symbol',
                    name: `${symbol} 專項投資`,
                    description: `包含 ${txs.length} 筆 ${symbol} 的交易記錄`,
                    transactionIds: txs.map(tx => tx.id),
                    priority: txs.length
                });
            }
        });

        // 按時間期間分組建議
        const periodGroups = this._groupByPeriod(transactions);
        Object.entries(periodGroups).forEach(([period, txs]) => {
            if (txs.length >= 5) {
                suggestions.push({
                    type: 'period',
                    name: `${period} 投資組合`,
                    description: `包含 ${txs.length} 筆該期間的交易記錄`,
                    transactionIds: txs.map(tx => tx.id),
                    priority: txs.length * 0.8
                });
            }
        });

        // 按投資金額分組建議
        const amountGroups = this._groupByAmount(transactions);
        Object.entries(amountGroups).forEach(([range, txs]) => {
            if (txs.length >= 4) {
                suggestions.push({
                    type: 'amount',
                    name: `${range} 投資策略`,
                    description: `包含 ${txs.length} 筆該金額範圍的交易`,
                    transactionIds: txs.map(tx => tx.id),
                    priority: txs.length * 0.6
                });
            }
        });

        return suggestions.sort((a, b) => b.priority - a.priority).slice(0, 5);
    },

    _groupBySymbol(transactions) {
        return transactions.reduce((groups, tx) => {
            if (!groups[tx.symbol]) groups[tx.symbol] = [];
            groups[tx.symbol].push(tx);
            return groups;
        }, {});
    },

    _groupByPeriod(transactions) {
        return transactions.reduce((groups, tx) => {
            const year = new Date(tx.date).getFullYear();
            const quarter = Math.ceil((new Date(tx.date).getMonth() + 1) / 3);
            const period = `${year}Q${quarter}`;
            if (!groups[period]) groups[period] = [];
            groups[period].push(tx);
            return groups;
        }, {});
    },

    _groupByAmount(transactions) {
        return transactions.reduce((groups, tx) => {
            const amount = tx.quantity * tx.price;
            let range;
            if (amount < 1000) range = '小額投資';
            else if (amount < 10000) range = '中額投資';
            else if (amount < 100000) range = '大額投資';
            else range = '巨額投資';
            
            if (!groups[range]) groups[range] = [];
            groups[range].push(tx);
            return groups;
        }, {});
    }
};

/**
 * 【新增】群組效能分析工具
 */
export const GroupAnalytics = {
    /**
     * 計算群組的投資績效摘要
     * @param {Array} groupTransactions - 群組內的交易記錄
     */
    calculateGroupPerformance(groupTransactions) {
        if (!groupTransactions.length) {
            return {
                totalInvestment: 0,
                totalTransactions: 0,
                uniqueSymbols: 0,
                avgTransactionSize: 0,
                dateRange: null
            };
        }

        const totalInvestment = groupTransactions.reduce((sum, tx) => {
            return sum + (tx.quantity * tx.price);
        }, 0);

        const uniqueSymbols = [...new Set(groupTransactions.map(tx => tx.symbol))].length;
        const dates = groupTransactions.map(tx => new Date(tx.date));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));

        return {
            totalInvestment,
            totalTransactions: groupTransactions.length,
            uniqueSymbols,
            avgTransactionSize: totalInvestment / groupTransactions.length,
            dateRange: {
                start: minDate.toLocaleDateString('zh-TW'),
                end: maxDate.toLocaleDateString('zh-TW')
            }
        };
    },

    /**
     * 生成群組比較報告
     * @param {Array} groups - 所有群組資料
     */
    generateGroupComparison(groups) {
        return groups.map(group => {
            const performance = this.calculateGroupPerformance(group.transactions || []);
            return {
                ...group,
                performance
            };
        }).sort((a, b) => b.performance.totalInvestment - a.performance.totalInvestment);
    }
};

// ========================= 【核心擴展 - 結束】 =========================

// 原有的群組管理功能（保持不變）
export async function loadGroups() {
    try {
        const result = await apiRequest('get_groups');
        if (result.success) {
            setState({ groups: result.data.groups || [] });
            await renderGroupsContent();
        }
    } catch (error) {
        console.error('載入群組失敗:', error);
        showNotification('error', '載入群組失敗');
    }
}

export async function handleCreateGroup() {
    openModal('group-modal', false);
}

export async function handleEditGroup(groupId) {
    const { groups } = getState();
    const group = groups.find(g => g.id === groupId);
    if (group) {
        openModal('group-modal', true, group);
    }
}

export async function handleDeleteGroup(groupId) {
    const { groups } = getState();
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    showConfirm(
        `確定要刪除群組「${group.name}」嗎？此操作無法復原。`,
        async () => {
            try {
                const result = await executeApiAction('delete_group', { groupId }, {
                    loadingText: '正在刪除群組...',
                    successMessage: '群組已成功刪除！',
                    shouldRefreshData: false
                });

                if (result) {
                    await loadGroups();
                }
            } catch (error) {
                console.error('刪除群組失敗:', error);
                showNotification('error', `刪除群組失敗: ${error.message}`);
            }
        },
        '確認刪除群組'
    );
}

// ========================= 【事件綁定增強】 =========================

/**
 * 【新增】初始化群組管理增強功能
 */
export function initializeGroupManagement() {
    // 綁定群組建議生成按鈕（如果存在）
    const suggestBtn = document.getElementById('generate-group-suggestions-btn');
    if (suggestBtn) {
        suggestBtn.addEventListener('click', async () => {
            const { transactions } = getState();
            const suggestions = GroupSuggestionEngine.generateGroupSuggestions(transactions);
            
            if (suggestions.length > 0) {
                showGroupSuggestions(suggestions);
            } else {
                showNotification('info', '目前沒有找到適合的群組建議');
            }
        });
    }

    // 綁定群組分析按鈕（如果存在）
    const analyzeBtn = document.getElementById('analyze-groups-btn');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', async () => {
            const { groups } = getState();
            const comparison = GroupAnalytics.generateGroupComparison(groups);
            showGroupAnalysis(comparison);
        });
    }
}

/**
 * 【新增】顯示群組建議界面
 */
function showGroupSuggestions(suggestions) {
    const modalContent = `
        <div class="max-w-2xl">
            <h3 class="text-lg font-semibold mb-4">智能群組建議</h3>
            <div class="space-y-3 mb-6">
                ${suggestions.map((suggestion, index) => `
                    <div class="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                        <div class="flex justify-between items-start">
                            <div class="flex-1">
                                <h4 class="font-medium text-gray-900">${suggestion.name}</h4>
                                <p class="text-sm text-gray-600 mt-1">${suggestion.description}</p>
                                <div class="flex items-center mt-2 space-x-4 text-xs text-gray-500">
                                    <span>類型: ${suggestion.type === 'symbol' ? '股票分組' : suggestion.type === 'period' ? '時間分組' : '金額分組'}</span>
                                    <span>優先級: ${suggestion.priority.toFixed(1)}</span>
                                </div>
                            </div>
                            <button onclick="createSuggestedGroup(${index})" 
                                    class="ml-4 px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
                                建立
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="flex justify-end">
                <button onclick="closeModal('suggestions-modal')" 
                        class="px-4 py-2 text-gray-600 hover:text-gray-800">
                    關閉
                </button>
            </div>
        </div>
    `;

    // 創建臨時模態窗
    const modal = document.createElement('div');
    modal.id = 'suggestions-modal';
    modal.className = 'fixed inset-0 z-50 overflow-y-auto';
    modal.innerHTML = `
        <div class="flex items-center justify-center min-h-screen p-4">
            <div class="fixed inset-0 bg-black bg-opacity-50" onclick="closeModal('suggestions-modal')"></div>
            <div class="bg-white rounded-lg shadow-xl p-6 z-50">
                ${modalContent}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    // 全局函數：建立建議的群組
    window.createSuggestedGroup = async (index) => {
        const suggestion = suggestions[index];
        try {
            const result = await GroupTransactionManager.updateGroupTransactions(null, suggestion.transactionIds, 'set');
            if (result) {
                closeModal('suggestions-modal');
                document.body.removeChild(modal);
                showNotification('success', `成功建立群組「${suggestion.name}」`);
            }
        } catch (error) {
            showNotification('error', '建立群組失敗');
        }
    };
}

/**
 * 【新增】顯示群組分析界面
 */
function showGroupAnalysis(comparison) {
    const modalContent = `
        <div class="max-w-4xl">
            <h3 class="text-lg font-semibold mb-4">群組效能分析</h3>
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">群組名稱</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">總投資</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">交易數</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">股票數</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">平均交易額</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">投資期間</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${comparison.map(group => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 font-medium text-gray-900">${group.name}</td>
                                <td class="px-4 py-3 text-sm text-gray-900">${group.performance.totalInvestment.toLocaleString()}</td>
                                <td class="px-4 py-3 text-sm text-gray-900">${group.performance.totalTransactions}</td>
                                <td class="px-4 py-3 text-sm text-gray-900">${group.performance.uniqueSymbols}</td>
                                <td class="px-4 py-3 text-sm text-gray-900">${group.performance.avgTransactionSize.toLocaleString()}</td>
                                <td class="px-4 py-3 text-sm text-gray-900">
                                    ${group.performance.dateRange ? 
                                        `${group.performance.dateRange.start} ~ ${group.performance.dateRange.end}` : 
                                        '無資料'}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="flex justify-end mt-6">
                <button onclick="closeAnalysisModal()" 
                        class="px-4 py-2 text-gray-600 hover:text-gray-800">
                    關閉
                </button>
            </div>
        </div>
    `;

    // 創建分析模態窗
    const modal = document.createElement('div');
    modal.id = 'analysis-modal';
    modal.className = 'fixed inset-0 z-50 overflow-y-auto';
    modal.innerHTML = `
        <div class="flex items-center justify-center min-h-screen p-4">
            <div class="fixed inset-0 bg-black bg-opacity-50" onclick="closeAnalysisModal()"></div>
            <div class="bg-white rounded-lg shadow-xl p-6 z-50">
                ${modalContent}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    window.closeAnalysisModal = () => {
        document.body.removeChild(modal);
        delete window.closeAnalysisModal;
    };
}

// 原有的群組選擇器更新功能（保持不變）
export async function updateGroupSelector() {
    const { groups } = getState();
    const selector = document.getElementById('group-selector');
    if (!selector) return;

    const currentValue = selector.value;
    selector.innerHTML = `
        <option value="all">全部股票</option>
        ${groups.map(group => 
            `<option value="${group.id}" ${group.id === currentValue ? 'selected' : ''}>${group.name}</option>`
        ).join('')}
    `;
}

// 初始化函數調用
document.addEventListener('DOMContentLoaded', () => {
    initializeGroupManagement();
});
