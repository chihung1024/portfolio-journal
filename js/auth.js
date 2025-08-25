// =========================================================================================
// == 身份驗證模組 (auth.js) v3.0 - Refactored
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

// ========================= 【核心修改 - 開始】 =========================
// 導入 app.js 中的啟動/停止函式，以及 main.js 中的主啟動函式
import { startLiveRefresh, stopLiveRefresh } from './app.js';
import { startApp } from './main.js';
// ========================= 【核心修改 - 結束】 =========================

// 初始化 Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

/**
 * 初始化 Firebase 認證監聽器
 */
export function initializeAuth() {
    onAuthStateChanged(auth, (user) => {
        const loadingOverlay = document.getElementById('loading-overlay');

        if (user) {
            // 使用者已登入
            console.log("使用者已登入:", user.uid);
            
            // ========================= 【核心修改 - 開始】 =========================
            // 將應用程式啟動的複雜流程，全部交給 main.js 中的 startApp 函式處理
            startApp(user);
            // 從 app.js 啟動即時刷新
            startLiveRefresh();
            // ========================= 【核心修改 - 結束】 =========================

        } else {
            // 使用者已登出或未登入
            console.log("使用者未登入。");
            // 登出時，重設 App 狀態
            setState({ 
                currentUserId: null,
                isAppInitialized: false // 允許下次登入時重新初始化
            });
        
            // 更新 UI
            document.getElementById('auth-container').classList.remove('hidden'); 
            document.querySelector('main').classList.add('hidden');
            document.getElementById('logout-btn').style.display = 'none';
            document.getElementById('user-info').classList.add('hidden');
        
            // 確保登出時隱藏讀取畫面
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
            
            // 從 app.js 停止即時刷新
            stopLiveRefresh();
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
        // 登出成功後，onAuthStateChanged 會自動觸發 UI 更新和 stopLiveRefresh
        showNotification('info', '您已成功登出。');
    } catch (error) {
        console.error("登出失敗:", error);
        showNotification('error', `登出失敗: ${error.message}`);
    }
}