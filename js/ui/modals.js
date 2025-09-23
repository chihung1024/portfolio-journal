// =========================================================================================
// == 彈出視窗模組 (modals.js) v5.0 - 群組管理交易選擇器整合
// =========================================================================================

import { getState, setState } from '../state.js';
import { stagingService } from '../staging.service.js';
import { isTwStock, formatNumber } from './utils.js';
import { renderDetailsModal } from './components/detailsModal.ui.js';
import { apiRequest, executeApiAction } from '../api.js';
import { loadGroups } from '../events/group.events.js';
import { showNotification } from './notifications.js';
import { renderTransactionsTable } from './components/transactions.ui.js';
import { 
    initializeTransactionSelector, 
    bindTransactionSelectorEvents, 
    getSelectedTransactionIds,
    setSelectedTransactionIds,
    clearAllSelections,
    destroyTransactionSelector
} from './components/transactionSelector.ui.js';

// --- Helper Functions ---

// ========================= 【核心修改 - 開始】 =========================
/**
 * 【重構】渲染群組歸因視窗的內容 (改為 async)
 * @param {Set<string>} includedGroupIds - 已包含的群組 ID 集合
 */
async function renderGroupAttributionContent(includedGroupIds = new Set()) {
    const { tempTransactionData, groups } = getState();
    if (!tempTransactionData) return;

    // 1. 從暫存區找出所有待刪除的群組 ID
    const stagedActions = await stagingService.getStagedActions();
    const deletedGroupIds = new Set(
        stagedActions
            .filter(a => a.entity === 'group' && a.type === 'DELETE')
            .map(a => a.payload.id)
    );
    
    // 2. 從 state 的群組列表中，過濾掉待刪除的群組
    const availableGroups = groups.filter(g => !deletedGroupIds.has(g.id));

    const symbol = tempTransactionData.data.symbol;
    document.getElementById('attribution-symbol-placeholder').textContent = symbol;

    const container = document.getElementById('attribution-groups-container');
    // 3. 使用過濾後的 `availableGroups` 來渲染選項
    container.innerHTML = availableGroups.length > 0
        ? availableGroups.map(g => `
            <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                <input type="checkbox" name="attribution_group" value="${g.id}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${includedGroupIds.has(g.id) ? 'checked' : ''}>
                <span class="font-medium text-gray-700">${g.name}</span>
            </label>
        `).join('')
        : '<p class="text-center text-sm text-gray-500 py-4">沒有可用的群組。</p>';

    const newGroupContainer = document.getElementById('attribution-new-group-container');
    newGroupContainer.innerHTML = `
        <div class="relative">
            <input type="text" id="new-group-name-input" placeholder="+ 建立新群組並加入" class="w-full pl-3 pr-10 py-2 text-sm border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <button type="button" id="add-new-group-btn" class="absolute inset-y-0 right-0 px-3 flex items-center text-indigo-600 hover:text-indigo-800">建立</button>
        </div>
    `;

    document.getElementById('add-new-group-btn').addEventListener('click', () => {
        const input = document.getElementById('new-group-name-input');
        const newGroupName = input.value.trim();
        if (newGroupName && !groups.some(g => g.name === newGroupName)) {
            const tempId = `temp_group_${Date.now()}`;
            const newGroupCheckbox = `
                <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer bg-indigo-50">
                    <input type="checkbox" name="attribution_group" value="${tempId}" data-new-name="${newGroupName}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked>
                    <span class="font-medium text-indigo-700">${newGroupName} (新)</span>
                </label>
            `;
            container.insertAdjacentHTML('beforeend', newGroupCheckbox);
            input.value = '';
        }
    });
}

/**
 * 【新增】渲染群組模態窗的交易選擇器界面
 */
function renderGroupTransactionSelector() {
    return `
        <div class="mb-6">
            <div class="flex justify-between items-center mb-3">
                <h4 class="text-lg font-semibold text-gray-800">交易紀錄管理</h4>
                <span class="text-sm text-gray-500">選擇此群組包含的交易</span>
            </div>
            
            <!-- 搜尋與篩選區域 -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <input type="text" id="transaction-search" 
                       placeholder="搜尋股票代碼、日期..." 
                       class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                
                <select id="symbol-filter" class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                    <option value="">所有股票</option>
                    <!-- 動態填入股票選項 -->
                </select>
                
                <select id="date-range-filter" class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                    <option value="">所有時間</option>
                    <option value="1m">近一個月</option>
                    <option value="3m">近三個月</option>
                    <option value="6m">近六個月</option>
                    <option value="1y">近一年</option>
                </select>
            </div>

            <!-- 批次操作區域 -->
            <div class="flex justify-between items-center mb-3 px-1">
                <div class="flex items-center space-x-4">
                    <button type="button" id="select-all-visible" 
                            class="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
                        全選可見
                    </button>
                    <button type="button" id="deselect-all-visible" 
                            class="text-sm text-gray-600 hover:text-gray-800 font-medium transition-colors">
                        全部取消
                    </button>
                </div>
                <span id="selection-count" class="text-sm text-gray-500 font-medium">
                    未選擇任何交易
                </span>
            </div>

            <!-- 交易紀錄列表 -->
            <div class="border border-gray-200 rounded-lg overflow-hidden">
                <div class="max-h-80 overflow-y-auto">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50 sticky top-0 z-10">
                            <tr>
                                <th class="w-12 px-3 py-3">
                                    <input type="checkbox" id="select-all-header" 
                                           class="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500">
                                </th>
                                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th>
                                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">類型</th>
                                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">數量</th>
                                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">價格</th>
                                <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">金額</th>
                            </tr>
                        </thead>
                        <tbody id="transaction-selection-list" class="bg-white divide-y divide-gray-200">
                            <!-- 動態填入交易紀錄 -->
                            <tr>
                                <td colspan="7" class="px-3 py-8 text-center text-sm text-gray-500">
                                    正在載入交易記錄...
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 統計信息 -->
            <div class="mt-3 flex justify-between text-xs text-gray-500">
                <span>選中的交易將用於計算此群組的投資績效</span>
                <span>已在其他群組的交易將標示為黃色</span>
            </div>
        </div>
    `;
}

/**
 * 【新增】處理群組模態窗的儲存操作
 */
async function handleGroupSave(isEditing = false) {
    const groupId = document.getElementById('group-id').value;
    const groupName = document.getElementById('group-name').value.trim();
    const description = document.getElementById('group-description').value.trim();

    if (!groupName) {
        showNotification('error', '請輸入群組名稱');
        return;
    }

    // 檢查名稱重複
    const { groups } = getState();
    const existingGroup = groups.find(g => g.name === groupName && g.id !== groupId);
    if (existingGroup) {
        showNotification('error', '群組名稱已存在');
        return;
    }

    // 獲取選中的交易ID
    const selectedTransactionIds = getSelectedTransactionIds();

    try {
        const groupData = {
            name: groupName,
            description: description || '',
            transactionIds: selectedTransactionIds
        };

        let result;
        if (isEditing) {
            result = await executeApiAction('update_group', {
                groupId: groupId,
                ...groupData
            }, {
                loadingText: '正在更新群組...',
                successMessage: '群組已成功更新！',
                shouldRefreshData: false
            });
        } else {
            result = await executeApiAction('create_group', groupData, {
                loadingText: '正在建立群組...',
                successMessage: '群組已成功建立！',
                shouldRefreshData: false
            });
        }

        if (result) {
            closeModal('group-modal');
            destroyTransactionSelector();
            await loadGroups();
        }

    } catch (error) {
        console.error('儲存群組失敗:', error);
        showNotification('error', `${isEditing ? '更新' : '建立'}群組失敗: ${error.message}`);
    }
}
// ========================= 【核心修改 - 結束】 =========================

/**
 * 收集群組歸因資訊，並將交易連同歸因資訊一併存入暫存區
 */
async function submitAttributionAndSaveTransaction() {
    const { tempTransactionData } = getState();
    if (!tempTransactionData) return;
    
    closeModal('group-attribution-modal');

    const groupInclusions = Array.from(document.querySelectorAll('input[name="attribution_group"]:checked')).map(cb => cb.value);
    
    const newGroups = Array.from(document.querySelectorAll('input[name="attribution_group"]:checked'))
        .filter(cb => cb.dataset.newName)
        .map(cb => ({
            tempId: cb.value,
            name: cb.dataset.newName
        }));
        
    const finalPayload = {
        ...tempTransactionData.data,
        groupInclusions: groupInclusions,
        newGroups: newGroups,
        _special_action: 'CREATE_TX_WITH_ATTRIBUTION'
    };

    try {
        await stagingService.addAction('CREATE', 'transaction', finalPayload);
        
        showNotification('info', '交易與群組歸因已暫存。');
        await renderTransactionsTable();

    } catch (error) {
        showNotification('error', `暫存交易失敗: ${error.message}`);
    } finally {
        setState({ tempTransactionData: null });
    }
}

async function handleMembershipSave() {
    const { tempMembershipEdit } = getState();
    if (!tempMembershipEdit) return;

    const selectedGroupIds = Array.from(document.querySelectorAll('input[name="membership_group"]:checked')).map(cb => cb.value);

    closeModal('membership-editor-modal');
    
    executeApiAction('update_transaction_group_membership', {
        transactionId: tempMembershipEdit.txId,
        groupIds: selectedGroupIds
    }, {
        loadingText: '正在更新群組歸屬...',
        successMessage: '群組歸屬已更新！',
        shouldRefreshData: false
    }).then(() => {
        loadGroups();
    }).catch(err => console.error("更新群組歸屬失敗:", err));
}

// --- Exported Functions ---

export async function openModal(modalId, isEdit = false, data = null) {
    const { stockNotes, pendingDividends, confirmedDividends, transactions, groups } = getState();
    const formId = modalId.replace('-modal', '-form');
    const form = document.getElementById(formId);
    if (form) form.reset();

    if (modalId === 'transaction-modal') {
        document.getElementById('transaction-id').value = '';
        const confirmBtn = document.getElementById('confirm-transaction-btn');
        
        if (isEdit && data) {
            document.getElementById('modal-title').textContent = '編輯交易紀錄';
            if(confirmBtn) confirmBtn.textContent = '儲存變更';
            
            document.getElementById('transaction-id').value = data.id;
            document.getElementById('transaction-date').value = data.date.split('T')[0];
            document.getElementById('stock-symbol').value = data.symbol;
            document.querySelector(`input[name="transaction-type"][value="${data.type}"]`).checked = true;
            document.getElementById('quantity').value = data.quantity;
            document.getElementById('price').value = data.price;
            document.getElementById('currency').value = data.currency;
            document.getElementById('exchange-rate').value = data.exchangeRate || '';
            document.getElementById('total-cost').value = data.totalCost || '';
        } else {
            document.getElementById('modal-title').textContent = '新增交易紀錄 (步驟 1/2)';
            if(confirmBtn) confirmBtn.textContent = '下一步';
            document.getElementById('transaction-date').value = new Date().toISOString().split('T')[0];
        }
        toggleOptionalFields();

    } else if (modalId === 'split-modal') {
        document.getElementById('split-date').value = new Date().toISOString().split('T')[0];

    } else if (modalId === 'group-modal') {
        // ========================= 【核心修改 - 群組模態窗增強】 =========================
        
        // 設置模態窗標題和按鈕文字
        const modalTitle = document.querySelector('#group-modal h3');
        const saveBtn = document.getElementById('save-group-btn');
        
        if (isEdit && data) {
            modalTitle.textContent = '編輯群組';
            saveBtn.textContent = '儲存變更';
            
            // 填入現有群組資料
            document.getElementById('group-id').value = data.id;
            document.getElementById('group-name').value = data.name;
            document.getElementById('group-description').value = data.description || '';
        } else {
            modalTitle.textContent = '新增群組';
            saveBtn.textContent = '建立群組';
            document.getElementById('group-id').value = '';
        }

        // 動態插入交易選擇器界面到群組符號容器
        const symbolsContainer = document.getElementById('group-symbols-container');
        symbolsContainer.innerHTML = renderGroupTransactionSelector();

        // 初始化交易選擇器
        let preSelectedIds = new Set();
        if (isEdit && data) {
            try {
                // 載入現有群組的交易
                const result = await apiRequest('get_group_transactions', { groupId: data.id });
                if (result.success) {
                    preSelectedIds = new Set(result.data.transactionIds);
                }
            } catch (error) {
                console.warn('載入群組交易失敗:', error);
                showNotification('warning', '載入現有交易記錄失敗，請手動選擇');
            }
        }

        await initializeTransactionSelector(data?.id, preSelectedIds);
        bindTransactionSelectorEvents();

        // 綁定儲存按鈕事件
        saveBtn.onclick = () => handleGroupSave(isEdit);
        document.getElementById('cancel-group-btn').onclick = () => {
            closeModal('group-modal');
            destroyTransactionSelector();
        };

        // ========================= 【群組模態窗增強結束】 =========================

    } else if (modalId === 'dividend-modal') {
        const record = isEdit
            ? confirmedDividends.find(d => d.id === data.id)
            : pendingDividends[data.index];
        if (!record) return;

        document.getElementById('dividend-modal-title').textContent = isEdit ? `編輯 ${record.symbol} 的配息` : `確認 ${record.symbol} 的配息`;
        document.getElementById('dividend-id').value = record.id || '';
        document.getElementById('dividend-symbol').value = record.symbol;
        document.getElementById('dividend-ex-date').value = record.ex_dividend_date.split('T')[0];
        document.getElementById('dividend-currency').value = record.currency;
        document.getElementById('dividend-quantity').value = record.quantity_at_ex_date;
        document.getElementById('dividend-original-amount-ps').value = record.amount_per_share;

        if (isEdit) {
            document.getElementById('dividend-pay-date').value = record.pay_date.split('T')[0];
            document.getElementById('dividend-total-amount').value = record.total_amount;
            document.getElementById('dividend-tax-rate').value = record.tax_rate;
            document.getElementById('dividend-notes').value = record.notes || '';
        } else {
            // 直接使用除息日作為預設發放日
            const payDateStr = record.ex_dividend_date.split('T')[0];
            document.getElementById('dividend-pay-date').value = payDateStr;
            const taxRate = isTwStock(record.symbol) ? 0 : 30;
            document.getElementById('dividend-tax-rate').value = taxRate;
            document.getElementById('dividend-total-amount').value = (record.quantity_at_ex_date * record.amount_per_share * (1 - taxRate / 100)).toFixed(4);
        }

    } else if (modalId === 'details-modal') {
        const { symbol } = data;
        if (symbol) {
           await renderDetailsModal(symbol);
        }
    } else if (modalId === 'membership-editor-modal') {
        const { txId } = data;
        
        const stagedActions = await stagingService.getStagedActions();
        const stagedTransactions = stagedActions.filter(a => a.entity === 'transaction' && a.type !== 'DELETE').map(a => a.payload);
        
        let combined = [...transactions];
        stagedTransactions.forEach(stagedTx => {
            const index = combined.findIndex(t => t.id === stagedTx.id);
            if (index > -1) {
                combined[index] = { ...combined[index], ...stagedTx };
            } else {
                combined.push(stagedTx);
            }
        });
        const tx = combined.find(t => t.id === txId);
        
        if (!tx) {
            showNotification('error', '找不到指定的交易紀錄來編輯群組。');
            return;
        }
        
        setState({ tempMembershipEdit: { txId } });

        document.getElementById('membership-symbol-placeholder').textContent = tx.symbol;
        document.getElementById('membership-date-placeholder').textContent = tx.date.split('T')[0];
        
        const container = document.getElementById('membership-groups-container');
        container.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">正在讀取歸屬狀態...</p>';
        
        try {
            const result = await apiRequest('get_transaction_memberships', { transactionId: txId });
            const includedGroupIds = new Set(result.data.groupIds);

            container.innerHTML = groups.length > 0
                ? groups.map(g => `
                    <label class="flex items-center space-x-3 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                        <input type="checkbox" name="membership_group" value="${g.id}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" ${includedGroupIds.has(g.id) ? 'checked' : ''}>
                        <span class="font-medium text-gray-700">${g.name}</span>
                    </label>
                `).join('')
                : '<p class="text-center text-sm text-gray-500 py-4">尚未建立任何群組。</p>';

        } catch (error) {
            container.innerHTML = '<p class="text-center text-sm text-red-500 py-4">讀取歸屬狀態失敗。</p>';
            console.error("讀取交易歸屬失敗:", error);
        }
    }

    document.getElementById(modalId).classList.remove('hidden');
    
    if (modalId === 'membership-editor-modal') {
        document.getElementById('save-membership-btn').onclick = handleMembershipSave;
        document.getElementById('cancel-membership-btn').onclick = () => closeModal('membership-editor-modal');
    }
}

/**
 * 【重構】開啟群組歸因視窗 (改為 async)
 */
export async function openGroupAttributionModal() {
    const { tempTransactionData } = getState();
    if (!tempTransactionData) return;

    const modalTitle = document.getElementById('attribution-modal-title');
    modalTitle.textContent = tempTransactionData.isEditing 
        ? '編輯交易紀錄 (步驟 2/2)' 
        : '新增交易紀錄 (步驟 2/2)';

    let includedGroupIds = new Set();
    const container = document.getElementById('attribution-groups-container');
    container.innerHTML = '<p class="text-center text-sm text-gray-500 py-4">正在讀取群組狀態...</p>';

    if (tempTransactionData.isEditing && tempTransactionData.txId) {
        try {
            const result = await apiRequest('get_transaction_memberships', { transactionId: tempTransactionData.txId });
            if (result.success) {
                includedGroupIds = new Set(result.data.groupIds);
            }
        } catch (error) {
            console.error("讀取交易歸屬失敗:", error);
            showNotification('error', '讀取現有群組歸屬失敗。');
        }
    }

    // 等待異步的渲染函式完成
    await renderGroupAttributionContent(includedGroupIds);
    
    const modalElement = document.getElementById('group-attribution-modal');
    modalElement.classList.remove('hidden');
    document.getElementById('confirm-attribution-btn').onclick = submitAttributionAndSaveTransaction;
    document.getElementById('cancel-attribution-btn').onclick = () => closeModal('group-attribution-modal');
}

export function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    
    // 如果關閉的是群組模態窗，清理交易選擇器資源
    if (modalId === 'group-modal') {
        destroyTransactionSelector();
    }
}

export function showConfirm(message, callback, title = '確認操作', cancelCallback = null) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    setState({ confirmCallback: callback });
    document.getElementById('confirm-cancel-btn').onclick = cancelCallback || (() => hideConfirm());
    document.getElementById('confirm-modal').classList.remove('hidden');
}

export function hideConfirm() {
    setState({ confirmCallback: null });
    document.getElementById('confirm-cancel-btn').onclick = () => hideConfirm();
    document.getElementById('confirm-modal').classList.add('hidden');
}

export function toggleOptionalFields() {
    const currency = document.getElementById('currency').value;
    const exchangeRateField = document.getElementById('exchange-rate-field');
    if (currency === 'TWD') {
        exchangeRateField.style.display = 'none';
    } else {
        exchangeRateField.style.display = 'block';
    }
}

// ========================= 【鍵盤事件處理增強】 =========================
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;

    const groupModal = document.getElementById('group-modal');
    if (!groupModal.classList.contains('hidden')) {
        e.preventDefault();
        // 如果焦點在搜尋框或其他輸入框，不觸發儲存
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
            return;
        }
        document.getElementById('save-group-btn').click();
        return;
    }

    const attributionModal = document.getElementById('group-attribution-modal');
    if (!attributionModal.classList.contains('hidden')) {
        e.preventDefault();
        if (document.activeElement === document.getElementById('new-group-name-input')) {
            document.getElementById('add-new-group-btn').click();
        } else {
            document.getElementById('confirm-attribution-btn').click();
        }
        return;
    }

    const membershipModal = document.getElementById('membership-editor-modal');
    if (!membershipModal.classList.contains('hidden')) {
        e.preventDefault();
        document.getElementById('save-membership-btn').click();
        return;
    }
});
// ========================= 【鍵盤事件處理增強結束】 =========================
