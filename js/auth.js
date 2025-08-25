// =========================================================================================
// == 身份驗證模組 (auth.js) v3.0.0 (Robust Initialization)
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
// 【修改】確保從 main.js 導入最新的函式
import { initializeAppUI, loadInitialDashboard, startLiveRefresh, stopLiveRefresh } from './main.js';

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
            setState({ currentUserId: user.uid });

            // ========================= 【核心 Bug 修復 - 開始】 =========================
            // 步驟 1: 更新基礎 UI，顯示主應用介面
            document.getElementById('auth-container').style.display = 'none';
            document.querySelector('main').classList.remove('hidden');
            document.getElementById('logout-btn').style.display = 'block';
            document.getElementById('user-info').classList.remove('hidden');
            document.getElementById('user-id').textContent = user.email;
            document.getElementById('auth-status').textContent = '已連線';
            
            // 步驟 2: 初始化 UI 元件 (如圖表物件) 和事件監聽器
            initializeAppUI();
            
            // 步驟 3: 呼叫重構後的、統一的初始資料載入函式。
            // 這個函式現在會自己處理 loading 畫面的顯示與隱藏。
            loadInitialDashboard(); 

            // 步驟 4: 在初始資料載入後，啟動自動刷新
            startLiveRefresh();
            // ========================= 【核心 Bug 修復 - 結束】 =========================

        } else {
            // 使用者已登出或未登入
            console.log("使用者未登入。");
            setState({ 
                currentUserId: null,
                isAppInitialized: false // 允許下次登入時重新初始化
            });
        
            // 更新 UI
            document.getElementById('auth-container').classList.remove('hidden'); 
            document.querySelector('main').classList.add('hidden');
            document.getElementById('logout-btn').style.display = 'none';
            document.getElementById('user-info').classList.add('hidden');
        
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
            
            stopLiveRefresh();
        }
    });

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
        stopLiveRefresh();
        showNotification('info', '您已成功登出。');
    } catch (error) {
        console.error("登出失敗:", error);
        showNotification('error', `登出失敗: ${error.message}`);
    }
}
