// =========================================================================================
// == 檔案：js/auth.js (v_arch_fix_final)
// == 職責：處理使用者身份驗證，並遵循正確的狀態管理規範
// =========================================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { setAuth } from './state.js'; // 【核心修正】: 導入職責明確的 setAuth 函式
import { renderUI } from './ui/utils.js';
import { getPortfolio } from './api.js';

let auth;
let app;

/**
 * 初始化 Firebase Authentication
 * @param {object} firebaseConfig - Firebase 設定物件
 */
function initializeAuth(firebaseConfig) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    setupAuthListener();
}

/**
 * 設置認證狀態監聽器
 */
function setupAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // 使用者已登入
            console.log("使用者已認證:", user.uid);
            // 【核心修正】: 不再使用已移除的 setState，改為呼叫職責明確的 setAuth 函式
            setAuth({ isAuthenticated: true, user: { uid: user.uid } });
            await getPortfolio(); // 登入後獲取投資組合數據
        } else {
            // 使用者未登入
            console.log("使用者未認證，嘗試匿名登入...");
            // 【核心修正】: 更新未認證狀態
            setAuth({ isAuthenticated: false, user: null });
            signInAnonymously(auth).catch((error) => {
                console.error("匿名登入失敗:", error);
            });
        }
        renderUI(); // 每次認證狀態改變時重新渲染 UI
    });
}

/**
 * 獲取當前使用者的認證權杖
 * @returns {Promise<string|null>} - JWT 權杖或 null
 */
async function getToken() {
    if (!auth.currentUser) {
        return null;
    }
    return await auth.currentUser.getIdToken(true);
}

export {
    initializeAuth,
    getToken
};
