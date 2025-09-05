// js/events/dividend.events.js

import { addDividend, updateDividend, deleteDividend, getDividends } from '../api.js';
import { renderDividendsTable } from '../ui/components/dividends.ui.js';
import { showModal, hideModal } from '../ui/modals.js';
import state from '../state.js';
import { showNotification } from '../ui/notifications.js';

export function setupDividendEventListeners() {
    const addDividendBtn = document.getElementById('add-dividend-btn');
    const dividendModal = document.getElementById('dividend-modal');
    const dividendForm = document.getElementById('dividend-form');
    const cancelDividendBtn = document.getElementById('cancel-dividend-btn');
    const dividendsTable = document.getElementById('dividends-table');

    if (addDividendBtn) {
        addDividendBtn.addEventListener('click', () => {
            dividendForm.reset();
            document.getElementById('dividend-id').value = '';
            document.getElementById('dividend-modal-title').textContent = '新增股息';
            // Populate symbol dropdown
            const symbolSelect = document.getElementById('dividend-symbol');
            const symbols = [...new Set(state.holdings.map(h => h.symbol))];
            symbolSelect.innerHTML = symbols.map(s => `<option value="${s}">${s}</option>`).join('');
            showModal('dividend-modal');
        });
    }

    if (dividendForm) {
        dividendForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(dividendForm);
            const dividendData = {
                symbol: formData.get('symbol'),
                amount: parseFloat(formData.get('amount')),
                date: formData.get('date'),
            };
            const dividendId = formData.get('id');

            try {
                if (dividendId) {
                    await updateDividend(dividendId, dividendData);
                    showNotification('股息更新成功', 'success');
                } else {
                    await addDividend(dividendData);
                    showNotification('股息新增成功', 'success');
                }
                hideModal('dividend-modal');
                await getDividends();
                renderDividendsTable();
            } catch (error) {
                showNotification(`操作失敗: ${error.message}`, 'error');
            }
        });
    }
    
    if (cancelDividendBtn) {
        cancelDividendBtn.addEventListener('click', () => {
            hideModal('dividend-modal');
        });
    }

    if (dividendsTable) {
        dividendsTable.addEventListener('click', async (event) => {
            const target = event.target;
            const dividendId = target.closest('tr')?.dataset.id;

            if (!dividendId) return;

            if (target.matches('.edit-dividend-btn, .edit-dividend-btn *')) {
                const dividend = state.dividends.find(d => d.id === dividendId);
                if (dividend) {
                    document.getElementById('dividend-id').value = dividend.id;
                    document.getElementById('dividend-modal-title').textContent = '編輯股息';
                    document.getElementById('dividend-symbol').innerHTML = `<option value="${dividend.symbol}">${dividend.symbol}</option>`;
                    document.getElementById('dividend-symbol').value = dividend.symbol;
                    document.getElementById('amount').value = dividend.amount;
                    document.getElementById('date').value = dividend.date;
                    showModal('dividend-modal');
                }
            }

            if (target.matches('.delete-dividend-btn, .delete-dividend-btn *')) {
                if (confirm('確定要刪除這筆股息嗎？')) {
                    try {
                        await deleteDividend(dividendId);
                        showNotification('股息刪除成功', 'success');
                        await getDividends();
                        renderDividendsTable();
                    } catch (error) {
                        showNotification(`刪除失敗: ${error.message}`, 'error');
                    }
                }
            }
        });
    }
}
