// =========================================================================================
// == 身份驗證模組 (auth.js) v2.8.2
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
// 【核心修改】引入新的輕量級載入函式，取代舊的 loadPortfolioData
import { initializeAppUI, loadInitialDashboardAndHoldings } from './main.js';
import { initializeAppUI, loadInitialDashboardAndHoldings, startLiveRefresh, stopLiveRefresh } from './main.js';

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

            // --- 【核心修改】---
            // 1. 立即顯示 App 主 UI 介面
            document.getElementById('auth-container').style.display = 'none';
            document.querySelector('main').classList.remove('hidden');
            document.getElementById('logout-btn').style.display = 'block';
            document.getElementById('user-info').classList.remove('hidden');
            document.getElementById('user-id').textContent = user.email;
            document.getElementById('auth-status').textContent = '已連線';
            
            // 2. 初始化 UI 元件 (如圖表物件) 和事件監聽
            initializeAppUI();
            
            // 3. 執行新的、更輕量的初始資料載入函式
            loadingText.textContent = '正在讀取核心資產數據...';
            loadingOverlay.style.display = 'flex';
            
            loadInitialDashboardAndHoldings(); // <--- 呼叫新的輕量級載入函式

            // 【新增】在初始資料載入後，啟動自動刷新
            startLiveRefresh();

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

            // 【新增】使用者登出時，停止自動刷新
            stopLiveRefresh();
            
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
        // 【新增】在登出前手動停止，確保計時器被清除
        stopLiveRefresh();
        showNotification('info', '您已成功登出。');
    } catch (error) {
        console.error("登出失敗:", error);
        showNotification('error', `登出失敗: ${error.message}`);
    }
}
