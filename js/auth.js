// =========================================================================================
// == 身份驗證模組 (auth.js) v3.1 (Circular Dependency Fix)
// =========================================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

import { firebaseConfig } from './config.js';
import { setState } from './state.js';
import { showNotification } from './ui/notifications.js';

// 【核心修改】移除對 main.js 的導入，以解決循環依賴問題
// import { initializeAppUI, loadInitialData, startLiveRefresh, stopLiveRefresh } from './main.js';

// 初始化 Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

/**
 * 【重構】初始化 Firebase 認證監聽器，並接受回呼函式
 * @param {object} callbacks - 包含 onLogin 和 onLogout 回呼的物件
 * @param {function} callbacks.onLogin - 登入成功時執行的函式
 * @param {function} callbacks.onLogout - 登出成功時執行的函式
 */
export function initializeAuth(callbacks) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // 使用者已登入
            console.log("使用者已登入:", user.uid);
            setState({ currentUserId: user.uid });

            // 【核心修改】呼叫由 main.js 傳入的 onLogin 回呼函式
            if (callbacks && typeof callbacks.onLogin === 'function') {
                callbacks.onLogin(user);
            }

        } else {
            // 使用者已登出或未登入
            console.log("使用者未登入。");
            setState({ currentUserId: null, isAppInitialized: false });

            // 【核心修改】呼叫由 main.js 傳入的 onLogout 回呼函式
            if (callbacks && typeof callbacks.onLogout === 'function') {
                callbacks.onLogout();
            }
        }
    });

    // 為登入表單增加 Enter 鍵監聽
    document.getElementById('auth-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // 防止表單預設提交行為
            document.getElementById('login-btn').click(); // 觸發登入按鈕
        }
    });
}

/**
 * 處理使用者註冊
 */
export async function handleRegister() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        showNotification('success', `註冊成功！歡迎 ${userCredential.user.email}`);
    } catch (error) {
        console.error("註冊失敗:", error);
        showNotification('error', `註冊失敗: ${error.message}`);
    }
}

/**
 * 處理使用者登入
 */
export async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        showNotification('success', `登入成功！歡迎回來 ${userCredential.user.email}`);
    } catch (error) {
        console.error("登入失敗:", error);
        showNotification('error', `登入失敗: ${error.message}`);
    }
}

/**
 * 處理使用者登出
 */
export async function handleLogout() {
    try {
        await signOut(auth);
        // 【核心修改】登出成功後的 UI 操作和計時器停止，已移至 main.js 的回呼函式中
        showNotification('info', '您已成功登出。');
    } catch (error) {
        console.error("登出失敗:", error);
        showNotification('error', `登出失敗: ${error.message}`);
    }
}
