// =========================================================================================
// == 檔案：js/settings.js (新檔案)
// == 職責：管理所有使用者自訂的偏好設定，例如顏色主題。
// =========================================================================================

// 定義兩種顏色主題的 CSS Class
const colorSchemes = {
    'red-gain': {
        gain: 'text-red-600',
        loss: 'text-green-600'
    },
    'green-gain': {
        gain: 'text-green-600',
        loss: 'text-red-600'
    }
};

let currentScheme = 'red-gain'; // 預設為國際/美股慣例 (紅漲綠跌)

/**
 * 初始化設定模組，從 localStorage 讀取使用者偏好
 */
export function initializeSettings() {
    const savedScheme = localStorage.getItem('portfolioColorScheme');
    if (savedScheme && colorSchemes[savedScheme]) {
        currentScheme = savedScheme;
    }
    // 應用初始主題到 UI 上 (例如 body class，如果需要的話)
    updateButtonIcon();
}

/**
 * 獲取當前應用的顏色設定
 * @returns {{gain: string, loss: string}} 包含 gain 和 loss CSS Class 的物件
 */
export function getColorSettings() {
    return colorSchemes[currentScheme];
}

/**
 * 切換顏色主題，並儲存到 localStorage
 */
export function toggleColorScheme() {
    currentScheme = currentScheme === 'red-gain' ? 'green-gain' : 'red-gain';
    localStorage.setItem('portfolioColorScheme', currentScheme);
    updateButtonIcon();
}

/**
 * 更新切換按鈕的圖示，以反映當前主題
 */
function updateButtonIcon() {
    const btn = document.getElementById('color-scheme-toggle-btn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (currentScheme === 'red-gain') {
        icon.setAttribute('data-lucide', 'palette');
        // 可選：增加 tooltip 提示
        btn.setAttribute('title', '目前為紅漲綠跌，點擊切換');
    } else {
        icon.setAttribute('data-lucide', 'palette');
         // 可選：增加 tooltip 提示
        btn.setAttribute('title', '目前為綠漲紅跌，點擊切換');
    }
    lucide.createIcons();
}
