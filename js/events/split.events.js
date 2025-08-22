// =========================================================================================
// == 拆股事件處理模組 (split.events.js) v3.0.0 - (核心重構) 支援 ATLAS-COMMIT
// =========================================================================================

import { getState, setState } from '../state.js';
import { apiRequest } from '../api.js';
import { openModal, closeModal, showConfirm } from '../ui/modals.js';
import { showNotification } from '../ui/notifications.js';
import { renderSplitsTable } from '../ui/components/splits.ui.js';
import { updateStagingBanner } from '../ui/components/stagingBanner.ui.js';
import { v4 as uuidv4 } from 'https://jspm.dev/uuid';


// --- Private Functions ---

async function handleDeleteSplit(button) {
    const splitId = button.dataset.id;
    
    showConfirm('確定要刪除這個拆股事件嗎？此操作將加入待辦清單。', () => {
        const currentState = getState();
        
        // 步驟 1: 樂觀更新
        const updatedSplits = currentState.userSplits.map(s => 
            s.id === splitId ? { ...s, status: 'STAGED_DELETE' } : s
        );

        const change = { 
            id: splitId, 
            op: 'DELETE', 
            entity: 'split', 
            payload: { id: splitId } 
        };
        
        const otherChanges = currentState.stagedChanges.filter(c => c.id !== splitId);

        setState({
            userSplits: updatedSplits,
            stagedChanges: [...otherChanges, change],
            hasStagedChanges: true,
        });

        renderSplitsTable();
        updateStagingBanner();

        // 步驟 2: 背景暫存
        apiRequest('stage_change', { op: 'DELETE', entity: 'split', payload: { id: splitId } })
            .then(() => {
                showNotification('info', '一筆拆股刪除操作已加入待辦。');
            })
            .catch(error => {
                showNotification('error', `暫存拆股刪除失敗: ${error.message}，建議刷新頁面。`);
                // 還原 UI
                setState({
                    userSplits: currentState.userSplits,
                    stagedChanges: currentState.stagedChanges,
                    hasStagedChanges: currentState.hasStagedChanges,
                });
                renderSplitsTable();
                updateStagingBanner();
            });
    });
}

async function handleSplitFormSubmit(e) {
    e.preventDefault();
    const splitData = {
        date: document.getElementById('split-date').value,
        symbol: document.getElementById('split-symbol').value.toUpperCase().trim(),
        ratio: parseFloat(document.getElementById('split-ratio').value)
    };

    if (!splitData.symbol || isNaN(splitData.ratio) || splitData.ratio <= 0) {
        showNotification('error', '請填寫所有欄位並確保比例大於0。');
        return;
    }
    
    closeModal('split-modal');
    
    const entityId = uuidv4();
    const payload = splitData;
    const op = 'CREATE';

    // 步驟 1: 樂觀更新
    const currentState = getState();
    const newSplit = { ...payload, id: entityId, status: 'STAGED_CREATE' };
    const updatedSplits = [newSplit, ...currentState.userSplits];
    
    const change = { id: entityId, op, entity: 'split', payload };

    setState({
        userSplits: updatedSplits,
        stagedChanges: [...currentState.stagedChanges, change],
        hasStagedChanges: true
    });
    
    renderSplitsTable();
    updateStagingBanner();

    // 步驟 2: 背景暫存
    apiRequest('stage_change', { op, entity: 'split', payload })
        .then(() => {
            showNotification('info', '一筆拆股事件已加入待辦。');
        })
        .catch(error => {
            showNotification('error', `暫存拆股事件失敗: ${error.message}，建議刷新頁面。`);
            setState({
                userSplits: currentState.userSplits,
                stagedChanges: currentState.stagedChanges,
                hasStagedChanges: currentState.hasStagedChanges
            });
            renderSplitsTable();
            updateStagingBanner();
        });
}

// --- Public Function ---

export function initializeSplitEventListeners() {
    const splitsTab = document.getElementById('splits-tab');
    if (splitsTab) {
        splitsTab.addEventListener('click', (e) => { 
            const addBtn = e.target.closest('#add-split-btn');
            if (addBtn) {
                openModal('split-modal');
                return;
            }
            
            const deleteBtn = e.target.closest('.delete-split-btn');
            if(deleteBtn) {
                handleDeleteSplit(deleteBtn);
            }
            // TODO: Add revert change logic here
        });
    }
    
    document.getElementById('split-form').addEventListener('submit', handleSplitFormSubmit);
    
    document.getElementById('cancel-split-btn').addEventListener('click', () => {
        closeModal('split-modal');
    });
}
