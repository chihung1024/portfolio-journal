// =========================================================================================
// == 身份驗證模組 (auth.js) v3.0 (Robust Initial Load)
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
// 廢除 loadInitialDashboard，改用能夠獲取完整數據的 loadPortfolioData
import { initializeAppUI, loadPortfolioData, startLiveRefresh, stopLiveRefresh } from './main.js';
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
            
            // 3. 【修改】執行新的、能獲取完整數據的初始載入函式
            loadingText.textContent = '正在從雲端同步所有數據...';
            loadingOverlay.style.display = 'flex';
            
            loadPortfolioData(); // <--- 直接呼叫能獲取包括 closedLots 在內的完整數據函式

            // 4. 在初始資料載入後，啟動自動刷新
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
            
            // 使用者登出時，停止自動刷新
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
        // 在登出前手動停止，確保計時器被清除
        stopLiveRefresh();
        showNotification('info', '您已成功登出。');
    } catch (error) {
        console.error("登出失敗:", error);
        showNotification('error', `登出失敗: ${error.message}`);
    }
}
