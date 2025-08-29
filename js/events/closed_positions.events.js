// =========================================================================================
// == 平倉紀錄事件處理模組 (closed_positions.events.js) - v2.0 (Nested Collapse Logic)
// == 職責：處理平倉紀錄頁籤上的所有使用者互動。
// =========================================================================================

import { getState, setState } from '../state.js';
import { renderClosedPositionsTable } from '../ui/components/closedPositions.ui.js';

/**
 * 【核心修改】處理點擊第一級摺疊項（股票代碼列）的事件
 * @param {string} symbol - 被點擊的股票代碼
 */
function handleToggleSymbolGroup(symbol) {
    const { activeClosedPosition } = getState();

    // 如果點擊的是當前已展開的股票，則完全收合 (設為 null)
    // 否則，展開新的股票，並預設其下所有子項為收合
    const newActiveState = (activeClosedPosition && activeClosedPosition.symbol === symbol)
        ? null
        : { symbol: symbol, expandedSales: new Set() };
    
    setState({ activeClosedPosition: newActiveState });
    renderClosedPositionsTable();
}

/**
 * 【新增】處理點擊第二級摺疊項（單筆平倉交易）的事件
 * @param {string} saleId - 被點擊的平倉交易的唯一 ID (格式: SYMBOL|YYYY-MM-DD)
 */
function handleToggleSaleDetail(saleId) {
    const { activeClosedPosition } = getState();
    // 此函式只應在已有股票被展開時觸發，因此 activeClosedPosition 不應為 null
    if (!activeClosedPosition) return;

    const { symbol, expandedSales } = activeClosedPosition;
    
    // 在 Set 中切換該 saleId 的存在狀態
    if (expandedSales.has(saleId)) {
        expandedSales.delete(saleId);
    } else {
        expandedSales.add(saleId);
    }
    
    // 更新 state
    setState({ activeClosedPosition: { symbol, expandedSales } });
    renderClosedPositionsTable();
}


/**
 * 初始化所有與平倉紀錄相關的事件監聽器
 */
export function initializeClosedPositionEventListeners() {
    const container = document.getElementById('closed-positions-tab');
    if (!container) return;

    container.addEventListener('click', (e) => {
        const symbolRow = e.target.closest('.closed-position-row');
        const saleHeader = e.target.closest('.closed-position-sale-header');

        // 【核心修改】根據點擊目標，分派到不同的處理函式
        if (saleHeader) {
            // 如果點擊的是第二級的標題，則優先處理第二級的摺疊
            e.preventDefault();
            e.stopPropagation(); // 防止事件冒泡觸發第一級的摺疊
            const saleId = saleHeader.dataset.saleId;
            if (saleId) {
                handleToggleSaleDetail(saleId);
            }
        } else if (symbolRow) {
            // 如果點擊的不是第二級標題，而是第一級的橫列，則處理第一級的摺疊
            e.preventDefault();
            const symbol = symbolRow.dataset.symbol;
            if (symbol) {
                handleToggleSymbolGroup(symbol);
            }
        }
    });
}
