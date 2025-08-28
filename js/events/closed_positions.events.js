// =========================================================================================
// == 平倉紀錄事件處理模組 (closed_positions.events.js) - 【新檔案】
// == 職責：處理平倉紀錄頁籤上的所有使用者互動。
// =========================================================================================

import { getState, setState } from '../state.js';
import { renderClosedPositionsTable } from '../ui/components/closedPositions.ui.js';

/**
 * 處理點擊平倉紀錄列的事件，用於展開或收合詳細資訊
 * @param {HTMLElement} rowElement - 被點擊的 <tr> 元素
 */
function handleToggleDetails(rowElement) {
    const symbol = rowElement.dataset.symbol;
    const { activeClosedPosition } = getState();

    // 如果點擊的是當前已展開的列，則收合它 (設為 null)；否則，展開新的列
    const newActiveSymbol = activeClosedPosition === symbol ? null : symbol;
    
    // 更新全域狀態
    setState({ activeClosedPosition: newActiveSymbol });
    
    // 重新渲染表格以反映狀態變更
    renderClosedPositionsTable();
}

/**
 * 初始化所有與平倉紀錄相關的事件監聽器
 */
export function initializeClosedPositionEventListeners() {
    const container = document.getElementById('closed-positions-tab');
    if (!container) return;

    container.addEventListener('click', (e) => {
        const row = e.target.closest('.closed-position-row');
        if (row) {
            e.preventDefault();
            handleToggleDetails(row);
        }
    });
}
