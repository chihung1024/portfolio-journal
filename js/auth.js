// =========================================================================================
// == 身份驗證模組 (auth.js)
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
import { loadPortfolioData } from './api.js';
import { showNotification } from './ui.js';

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
            // 使用者已登入
            console.log("使用者已登入:", user.uid);
            setState({ currentUserId: user.uid });

            // 更新 UI
            document.getElementById('auth-container').style.display = 'none';
            document.querySelector('main').classList.remove('hidden');
            document.getElementById('logout-btn').style.display = 'block';
            document.getElementById('user-info').classList.remove('hidden');
            document.getElementById('user-id').textContent = user.email;
            document.getElementById('auth-status').textContent = '已連線';
            
            loadingText.textContent = '正在從雲端同步資料...';
            loadPortfolioData();

        } else {
            // 使用者已登出或未登入
            console.log("使用者未登入。");
            setState({ currentUserId: null });

            // 更新 UI
            document.getElementById('auth-container').style.display = 'block';
            document.querySelector('main').classList.add('hidden');
            document.getElementById('logout-btn').style.display = 'none';
            document.getElementById('user-info').classList.add('hidden');
            loadingOverlay.style.display = 'none';
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
