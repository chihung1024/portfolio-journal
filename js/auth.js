// =========================================================================================
// == 身份驗證模組 (auth.js) v2.9.1 (UI 可見性修正)
// =========================================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";

import { firebaseConfig } from './config.js';
import { setState } from './state.js';
import { showNotification } from './ui/notifications.js';
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
        const loadingText = document.getElementById('loading-text');

        if (user) {
            console.log("使用者已登入:", user.uid);
            setState({ currentUserId: user.uid });

            document.getElementById('auth-container').style.display = 'none';
            document.querySelector('main').classList.remove('hidden');
            document.getElementById('user-info').classList.remove('hidden');
            document.getElementById('user-id').textContent = user.email;
            document.getElementById('auth-status').textContent = '已連線';
            
            // ========================= 【核心修改 - 開始】 =========================
            // 顯示包含同步和登出按鈕的整個容器
            document.getElementById('user-actions').classList.remove('hidden');
            // ========================= 【核心修改 - 結束】 =========================
            
            initializeAppUI();
            
            loadingText.textContent = '正在讀取核心資產數據...';
            loadingOverlay.style.display = 'flex';
            
            loadInitialDashboard();

            startLiveRefresh();

        } else {
            console.log("使用者未登入。");
            setState({ 
                currentUserId: null,
                isAppInitialized: false 
            });
        
            document.getElementById('auth-container').classList.remove('hidden'); 
            document.querySelector('main').classList.add('hidden');
            document.getElementById('user-info').classList.add('hidden');
            
            // ========================= 【核心修改 - 開始】 =========================
            // 隱藏包含同步和登出按鈕的整個容器
            document.getElementById('user-actions').classList.add('hidden');
            // ========================= 【核心修改 - 結束】 =========================

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
