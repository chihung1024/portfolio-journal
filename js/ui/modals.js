// =========================================================================================
// == 檔案：js/ui/modals.js (v_arch_final_cleanup)
// == 職責：提供並管理所有模態框（彈出視窗）的通用行為，如開啟與關閉。
// == 架構定案：此模組不再處理任何與特定表單提交或 API 請求相關的業務邏輯。
// =========================================================================================

/**
 * 開啟一個指定的模態框
 * @param {string} modalId - 要開啟的模態框的 HTML ID
 */
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
        console.error(`模態框未找到: ${modalId}`);
        return;
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden'); // 防止背景滾動
}

/**
 * 關閉一個指定的模態框
 * @param {string} modalId - 要關閉的模態框的 HTML ID
 */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) {
        console.error(`模態框未找到: ${modalId}`);
        return;
    }
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // 檢查是否還有其他開啟的模態框，如果沒有，才恢復背景滾動
    const anyModalOpen = document.querySelector('.modal:not(.hidden)');
    if (!anyModalOpen) {
        document.body.classList.remove('overflow-hidden');
    }
}

/**
 * 初始化所有模態框的通用事件監聽器
 * 這段程式碼負責處理所有模態框的關閉行為，例如點擊關閉按鈕、背景遮罩或按下 Esc 鍵。
 */
function initializeModalEventListeners() {
    document.body.addEventListener('click', (event) => {
        // 處理點擊帶有 `data-dismiss="modal"` 屬性的元素
        const dismissButton = event.target.closest('[data-dismiss="modal"]');
        if (dismissButton) {
            const modal = dismissButton.closest('.modal');
            if (modal) {
                closeModal(modal.id);
            }
            return;
        }

        // 處理點擊模態框的背景遮罩
        if (event.target.matches('.modal')) {
            closeModal(event.target.id);
        }
    });

    // 處理按下 'Escape' 鍵
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            const openModalElement = document.querySelector('.modal:not(.hidden)');
            if (openModalElement) {
                closeModal(openModalElement.id);
            }
        }
    });

    // 【架構性修正】
    // 先前版本中所有與特定表單（如交易、群組、股息）提交相關的事件監聽器
    // (`transaction-form.addEventListener`, etc.) 都已被移除。
    // 這些業務邏輯的職責現已完全轉移至各自的 `js/events/*.events.js` 模組中，
    // 確保了此模組的單一職責與整個前端架構的一致性。
}

export {
    openModal,
    closeModal,
    initializeModalEventListeners,
};
