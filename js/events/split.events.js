// js/events/split.events.js

import { addSplit, updateSplit, deleteSplit, getSplits } from '../api.js';
import { renderSplitsTable } from '../ui/components/splits.ui.js';
import { showModal, hideModal } from '../ui/modals.js';
import state from '../state.js';
import { showNotification } from '../ui/notifications.js';

export function setupSplitEventListeners() {
    const addSplitBtn = document.getElementById('add-split-btn');
    const splitModal = document.getElementById('split-modal');
    const splitForm = document.getElementById('split-form');
    const cancelSplitBtn = document.getElementById('cancel-split-btn');
    const splitsTable = document.getElementById('splits-table');

    if (addSplitBtn) {
        addSplitBtn.addEventListener('click', () => {
            splitForm.reset();
            document.getElementById('split-id').value = '';
            document.getElementById('split-modal-title').textContent = '新增股票分割';
            
            const symbolSelect = document.getElementById('split-symbol');
            const symbols = [...new Set(state.transactions.map(t => t.symbol))];
            symbolSelect.innerHTML = symbols.map(s => `<option value="${s}">${s}</option>`).join('');
            showModal('split-modal');
        });
    }

    if (splitForm) {
        splitForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(splitForm);
            const splitData = {
                symbol: formData.get('symbol'),
                date: formData.get('date'),
                from_factor: parseInt(formData.get('from_factor'), 10),
                to_factor: parseInt(formData.get('to_factor'), 10),
            };
            const splitId = formData.get('id');

            try {
                if (splitId) {
                    await updateSplit(splitId, splitData);
                    showNotification('股票分割更新成功', 'success');
                } else {
                    await addSplit(splitData);
                    showNotification('股票分割新增成功', 'success');
                }
                hideModal('split-modal');
                await getSplits();
                renderSplitsTable();
            } catch (error) {
                showNotification(`操作失敗: ${error.message}`, 'error');
            }
        });
    }

    if (cancelSplitBtn) {
        cancelSplitBtn.addEventListener('click', () => {
            hideModal('split-modal');
        });
    }

    if (splitsTable) {
        splitsTable.addEventListener('click', async (event) => {
            const target = event.target;
            const splitId = target.closest('tr')?.dataset.id;

            if (!splitId) return;

            if (target.matches('.edit-split-btn, .edit-split-btn *')) {
                const split = state.splits.find(s => s.id === splitId);
                if (split) {
                    document.getElementById('split-id').value = split.id;
                    document.getElementById('split-modal-title').textContent = '編輯股票分割';
                    const symbolSelect = document.getElementById('split-symbol');
                    symbolSelect.innerHTML = `<option value="${split.symbol}">${split.symbol}</option>`;
                    symbolSelect.value = split.symbol;
                    document.getElementById('split-date').value = split.date;
                    document.getElementById('from_factor').value = split.from_factor;
                    document.getElementById('to_factor').value = split.to_factor;
                    showModal('split-modal');
                }
            }

            if (target.matches('.delete-split-btn, .delete-split-btn *')) {
                if (confirm('確定要刪除這筆股票分割紀錄嗎？')) {
                    try {
                        await deleteSplit(splitId);
                        showNotification('股票分割刪除成功', 'success');
                        await getSplits();
                        renderSplitsTable();
                    } catch (error) {
                        showNotification(`刪除失敗: ${error.message}`, 'error');
                    }
                }
            }
        });
    }
}
