// =========================================================================================
// == 檔案：js/events/staging.events.js (v_arch_final_stage_2)
// == 職責：處理「暫存區」的 UI 事件，並遵循正確的 API 客戶端架構
// =========================================================================================

import { showNotification } from '../ui/utils.js';
import { parseStagingData } from '../staging.service.js';
// 【核心修正】: 移除對任何泛用 API 函式的依賴，改為導入職責明確的 API 函式
import { processStagedTransactions } from '../api.js';

let parsedData = [];

/**
 * 初始化暫存區相關的事件監聽器
 */
function initializeStagingEventListeners() {
    const stagingTextarea = document.getElementById('staging-textarea');
    const processStagingBtn = document.getElementById('process-staging-btn');
    const stagingPreview = document.getElementById('staging-preview');

    if (!stagingTextarea || !processStagingBtn || !stagingPreview) return;

    // 監聽貼上事件，自動解析
    stagingTextarea.addEventListener('paste', (event) => {
        // 使用 setTimeout 以確保在貼上完成後才讀取 textarea 的值
        setTimeout(() => {
            handleParseStagingData();
        }, 0);
    });
    
    // 監聽手動輸入
    stagingTextarea.addEventListener('input', handleParseStagingData);

    // 監聽 "處理" 按鈕點擊
    processStagingBtn.addEventListener('click', async () => {
        if (parsedData.length > 0) {
            await handleProcessStaging();
        } else {
            showNotification('沒有可處理的數據', 'error');
        }
    });
}

/**
 * 處理從 textarea 解析數據的邏輯
 */
function handleParseStagingData() {
    const stagingTextarea = document.getElementById('staging-textarea');
    const stagingPreview = document.getElementById('staging-preview');
    const processStagingBtn = document.getElementById('process-staging-btn');
    const rawData = stagingTextarea.value;

    try {
        parsedData = parseStagingData(rawData);
        renderStagingPreview(parsedData, stagingPreview);
        processStagingBtn.disabled = parsedData.length === 0;
    } catch (error) {
        console.error("解析暫存區數據失敗:", error);
        stagingPreview.innerHTML = `<p class="text-red-500">${error.message}</p>`;
        parsedData = [];
        processStagingBtn.disabled = true;
    }
}

/**
 * 處理將解析後的數據提交至後端的邏輯
 */
async function handleProcessStaging() {
    const processStagingBtn = document.getElementById('process-staging-btn');
    processStagingBtn.disabled = true;
    processStagingBtn.textContent = '處理中...';

    try {
        // 【核心修正】: 直接呼叫從 api.js 導入的、職責明確的新函式
        await processStagedTransactions(parsedData);
        showNotification(`成功匯入 ${parsedData.length} 筆交易`, 'success');
        
        // 成功後清空暫存區
        document.getElementById('staging-textarea').value = '';
        parsedData = [];
        renderStagingPreview([], document.getElementById('staging-preview'));

    } catch (error) {
        console.error('處理暫存區數據失敗:', error);
        showNotification('處理失敗，請檢查數據格式或稍後再試', 'error');
    } finally {
        processStagingBtn.disabled = false;
        processStagingBtn.textContent = '處理';
    }
}

/**
 * 渲染暫存區數據的預覽
 * @param {Array<object>} data - 解析後的數據
 * @param {HTMLElement} container - 預覽容器
 */
function renderStagingPreview(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<p class="text-gray-500">此處將顯示解析後的數據預覽...</p>';
        return;
    }
    
    const rows = data.map(item => `
        <tr>
            <td class="border px-2 py-1">${item.date}</td>
            <td class="border px-2 py-1">${item.symbol}</td>
            <td class="border px-2 py-1">${item.type}</td>
            <td class="border px-2 py-1">${item.quantity}</td>
            <td class="border px-2 py-1">${item.price_per_share}</td>
            <td class="border px-2 py-1">${item.currency}</td>
        </tr>
    `).join('');

    container.innerHTML = `
        <p class="mb-2">成功解析 ${data.length} 筆交易:</p>
        <table class="w-full text-xs text-left">
            <thead>
                <tr>
                    <th class="border px-2 py-1">日期</th>
                    <th class="border px-2 py-1">代碼</th>
                    <th class="border px-2 py-1">類型</th>
                    <th class="border px-2 py-1">股數</th>
                    <th class="border px-2 py-1">價格</th>
                    <th class="border px-2 py-1">貨幣</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

export { initializeStagingEventListeners };
