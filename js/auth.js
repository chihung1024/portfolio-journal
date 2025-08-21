// =========================================================================================
// == 身份驗證模組 (auth.js) v3.0.1 - ATLAS-COMMIT Architecture (Full Version)
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
// [核心修改] 從 main.js 引入新的主流程函式
import { onLoginSuccess } from './main.js';

// 初始化 Firebase
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

/**
 * 初始化 Firebase 認證監聽器
 */
export function initializeAuth() {
    onAuthStateChanged(auth, async (user) => {
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');

        if (user) {
            // 使用者已登入
            console.log("使用者已登入:", user.uid);
            setState({ currentUserId: user.uid });

            // 顯示 App 主 UI 介面
            document.getElementById('auth-container').style.display = 'none';
            document.querySelector('main').classList.remove('hidden');
            document.getElementById('logout-btn').style.display = 'block';
            document.getElementById('user-info').classList.remove('hidden');
            document.getElementById('user-id').textContent = user.email;
            document.getElementById('auth-status').textContent = '已連線';
            
            // 顯示主載入畫面，直到核心數據載入完成
            loadingText.textContent = '正在讀取核心資產數據...';
            loadingOverlay.style.display = 'flex';
            
            // [核心修改] 將控制權交給 main.js 的主流程函式
            await onLoginSuccess();
            
            // onLoginSuccess 內部會處理隱藏 loadingOverlay

        } else {
            // 使用者已登出或未登入
            console.log("使用者未登入。");
            setState({ 
                currentUserId: null,
                isAppInitialized: false
            });
        
            // 更新 UI
            document.getElementById('auth-container').classList.remove('hidden'); 
            document.querySelector('main').classList.add('hidden');
            document.getElementById('logout-btn').style.display = 'none';
            document.getElementById('user-info').classList.add('hidden');
        
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
        }
    });
}

/**
 * 處理使用者註冊
 */
export async function handleRegister() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if (!email || !password) {
        showNotification('error', '請輸入電子郵件和密碼。');
        return;
    }
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        showNotification('success', `註冊成功！歡迎 ${userCredential.user.email}`);
    } catch (error) {
        showNotification('error', `註冊失敗: ${error.message}`);
    }
}

/**
 * 處理使用者登入
 */
export async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if (!email || !password) {
        showNotification('error', '請輸入電子郵件和密碼。');
        return;
    }
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        showNotification('success', `登入成功！歡迎回來 ${userCredential.user.email}`);
    } catch (error) {
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
        // 刷新頁面以確保所有狀態被清除
        window.location.reload();
    } catch (error) {
        showNotification('error', `登出失敗: ${error.message}`);
    }
}
