// =========================================================================================
// == 身份驗證模組 (auth.js) v4.0 (Event-Driven & Decoupled)
// == 職責：純粹的認證狀態管理器，透過廣播全局事件來通知應用程式。
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

// 初始化 Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

/**
 * 【重構】初始化 Firebase 認證監聽器，使用事件廣播模式
 */
export function initializeAuth() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // 使用者已登入
            console.log("使用者已登入:", user.uid);
            setState({ currentUserId: user.uid });

            // 【核心修改】廣播一個 'auth:loggedIn' 事件，並將 user 物件作為細節傳遞
            const event = new CustomEvent('auth:loggedIn', { detail: { user } });
            document.dispatchEvent(event);

        } else {
            // 使用者已登出或未登入
            console.log("使用者未登入。");
            setState({ currentUserId: null, isAppInitialized: false });

            // 【核心修改】廣播一個 'auth:loggedOut' 事件
            const event = new CustomEvent('auth:loggedOut');
            document.dispatchEvent(event);
        }
    });

    // 為登入表單增加 Enter 鍵監聽
    document.getElementById('auth-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('login-btn').click();
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
        showNotification('info', '您已成功登出。');
    } catch (error) {
        console.error("登出失敗:", error);
        showNotification('error', `登出失敗: ${error.message}`);
    }
}
