// =========================================================================================
// == API 模組 (api.js) v3.0 - 群組交易管理API擴展
// =========================================================================================

import { getState } from './state.js';
import { showNotification } from './ui/notifications.js';

// API 配置
const API_CONFIG = {
    baseURL: '/api',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000
};

// ========================= 【核心API擴展 - 開始】 =========================

/**
 * 【新增】群組交易管理API端點映射
 */
const GROUP_TRANSACTION_ENDPOINTS = {
    // 群組交易關聯管理
    update_group_transactions: {
        method: 'POST',
        path: '/groups/{groupId}/transactions',
        description: '批次更新群組包含的交易記錄'
    },
    get_group_transactions: {
        method: 'GET', 
        path: '/groups/{groupId}/transactions',
        description: '獲取群組的所有交易記錄'
    },
    check_transaction_conflicts: {
        method: 'POST',
        path: '/transactions/check-conflicts',
        description: '檢查交易是否被其他群組使用'
    },
    get_transaction_memberships: {
        method: 'GET',
        path: '/transactions/{transactionId}/memberships',
        description: '獲取交易所屬的群組列表'
    },
    update_transaction_group_membership: {
        method: 'PUT',
        path: '/transactions/{transactionId}/memberships',
        description: '更新交易的群組歸屬'
    },

    // 批次操作API
    bulk_move_transactions: {
        method: 'POST',
        path: '/groups/bulk-move-transactions',
        description: '批次移動交易到其他群組'
    },
    bulk_copy_transactions: {
        method: 'POST',
        path: '/groups/bulk-copy-transactions', 
        description: '批次複製交易到其他群組'
    },

    // 群組分析API
    get_group_analytics: {
        method: 'GET',
        path: '/groups/{groupId}/analytics',
        description: '獲取群組效能分析數據'
    },
    get_groups_comparison: {
        method: 'GET',
        path: '/groups/comparison',
        description: '獲取所有群組的比較分析'
    },

    // 智能建議API
    get_group_suggestions: {
        method: 'GET',
        path: '/groups/suggestions',
        description: '獲取智能群組建立建議'
    },
    create_suggested_group: {
        method: 'POST',
        path: '/groups/create-from-suggestion',
        description: '基於建議建立群組'
    }
};

/**
 * 【新增】API端點註冊機制
 */
class ApiEndpointRegistry {
    constructor() {
        this.endpoints = new Map();
        this.middleware = [];
    }

    register(name, config) {
        this.endpoints.set(name, {
            ...config,
            name,
            registeredAt: new Date().toISOString()
        });
    }

    get(name) {
        return this.endpoints.get(name);
    }

    addMiddleware(middleware) {
        this.middleware.push(middleware);
    }

    async executeWithMiddleware(name, requestConfig) {
        let config = { ...requestConfig };
        
        // 執行前置中間件
        for (const middleware of this.middleware) {
            if (middleware.before) {
                config = await middleware.before(name, config);
            }
        }

        let result;
        try {
            result = await this.execute(name, config);
            
            // 執行後置中間件
            for (const middleware of this.middleware) {
                if (middleware.after) {
                    result = await middleware.after(name, result, config);
                }
            }
        } catch (error) {
            // 執行錯誤中間件
            for (const middleware of this.middleware) {
                if (middleware.error) {
                    error = await middleware.error(name, error, config);
                }
            }
            throw error;
        }

        return result;
    }

    async execute(name, config) {
        const endpoint = this.get(name);
        if (!endpoint) {
            throw new Error(`API端點 '${name}' 未找到`);
        }

        return await makeRequest(endpoint, config);
    }
}

// 建立全域API註冊表
const apiRegistry = new ApiEndpointRegistry();

/**
 * 【新增】註冊所有API端點
 */
function registerApiEndpoints() {
    // 註冊現有API端點（保持向後兼容）
    const EXISTING_ENDPOINTS = {
        get_transactions: { method: 'GET', path: '/transactions' },
        create_transaction: { method: 'POST', path: '/transactions' },
        update_transaction: { method: 'PUT', path: '/transactions/{id}' },
        delete_transaction: { method: 'DELETE', path: '/transactions/{id}' },
        get_holdings: { method: 'GET', path: '/holdings' },
        get_groups: { method: 'GET', path: '/groups' },
        create_group: { method: 'POST', path: '/groups' },
        update_group: { method: 'PUT', path: '/groups/{id}' },
        delete_group: { method: 'DELETE', path: '/groups/{id}' },
        get_dividends: { method: 'GET', path: '/dividends' },
        create_dividend: { method: 'POST', path: '/dividends' },
        get_splits: { method: 'GET', path: '/splits' },
        create_split: { method: 'POST', path: '/splits' },
        recalculate_holdings: { method: 'POST', path: '/recalculate' }
    };

    // 註冊現有端點
    Object.entries(EXISTING_ENDPOINTS).forEach(([name, config]) => {
        apiRegistry.register(name, config);
    });

    // 註冊新的群組交易管理端點
    Object.entries(GROUP_TRANSACTION_ENDPOINTS).forEach(([name, config]) => {
        apiRegistry.register(name, config);
    });
}

/**
 * 【新增】API中間件：請求日誌
 */
const loggingMiddleware = {
    before: async (name, config) => {
        console.log(`[API] 請求開始: ${name}`, config);
        return config;
    },
    after: async (name, result, config) => {
        console.log(`[API] 請求完成: ${name}`, { success: result.success, dataSize: result.data ? JSON.stringify(result.data).length : 0 });
        return result;
    },
    error: async (name, error, config) => {
        console.error(`[API] 請求失敗: ${name}`, error);
        return error;
    }
};

/**
 * 【新增】API中間件：快取管理
 */
const cacheMiddleware = {
    cache: new Map(),
    
    before: async (name, config) => {
        // 只對GET請求進行快取
        if (config.method === 'GET') {
            const cacheKey = `${name}_${JSON.stringify(config.data || {})}`;
            const cached = this.cache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < 30000) { // 30秒快取
                console.log(`[Cache] 命中: ${name}`);
                throw new CacheHitResult(cached.data);
            }
        }
        return config;
    },
    
    after: async (name, result, config) => {
        // 快取成功的GET請求結果
        if (config.method === 'GET' && result.success) {
            const cacheKey = `${name}_${JSON.stringify(config.data || {})}`;
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });
        }
        return result;
    }
};

class CacheHitResult extends Error {
    constructor(data) {
        super('Cache hit');
        this.data = data;
        this.isCache = true;
    }
}

/**
 * 【增強】HTTP請求處理函數
 */
async function makeRequest(endpoint, config = {}) {
    const { method, path } = endpoint;
    const { data, params, headers = {} } = config;

    // 處理路徑參數
    let finalPath = path;
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
        });
    }

    const url = `${API_CONFIG.baseURL}${finalPath}`;
    const requestConfig = {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        }
    };

    if (data && method !== 'GET') {
        requestConfig.body = JSON.stringify(data);
    } else if (data && method === 'GET') {
        // GET請求將data轉為query parameters
        const searchParams = new URLSearchParams();
        Object.entries(data).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                searchParams.append(key, value.toString());
            }
        });
        if (searchParams.toString()) {
            finalPath += `?${searchParams.toString()}`;
        }
    }

    // 設置超時
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);
    requestConfig.signal = controller.signal;

    try {
        const response = await fetch(url, requestConfig);
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = errorJson.message || errorJson.error || `HTTP ${response.status}`;
            } catch {
                errorMessage = errorText || `HTTP ${response.status}`;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        return result;

    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            throw new Error('請求超時');
        }
        
        throw error;
    }
}

/**
 * 【增強】帶重試機制的API請求
 */
async function makeRequestWithRetry(endpoint, config = {}, retryCount = 0) {
    try {
        return await makeRequest(endpoint, config);
    } catch (error) {
        if (retryCount < API_CONFIG.retryAttempts && 
            (error.message.includes('網路') || error.message.includes('timeout') || error.message.includes('超時'))) {
            
            console.warn(`[API] 請求失敗，${API_CONFIG.retryDelay}ms後重試 (${retryCount + 1}/${API_CONFIG.retryAttempts}):`, error.message);
            
            await new Promise(resolve => setTimeout(resolve, API_CONFIG.retryDelay));
            return makeRequestWithRetry(endpoint, config, retryCount + 1);
        }
        throw error;
    }
}

// ========================= 【核心API擴展 - 結束】 =========================

/**
 * 【重構】主要API請求函數
 */
export async function apiRequest(endpoint, data = {}, options = {}) {
    const {
        showLoading = false,
        loadingText = '處理中...',
        retries = true
    } = options;

    if (showLoading) {
        showLoadingOverlay(loadingText);
    }

    try {
        // 使用註冊表執行API請求
        const result = await (retries ? 
            apiRegistry.executeWithMiddleware(endpoint, { data, ...options }) :
            apiRegistry.execute(endpoint, { data, ...options })
        );

        return result;

    } catch (error) {
        if (error instanceof CacheHitResult) {
            return error.data;
        }

        console.error(`[API] ${endpoint} 請求失敗:`, error);
        throw error;

    } finally {
        if (showLoading) {
            hideLoadingOverlay();
        }
    }
}

/**
 * 【增強】執行API操作並處理UI反饋
 */
export async function executeApiAction(endpoint, data = {}, options = {}) {
    const {
        loadingText = '處理中...',
        successMessage = '操作成功！',
        errorMessage = '操作失敗',
        shouldRefreshData = true,
        confirmBefore = null
    } = options;

    // 如果需要確認
    if (confirmBefore) {
        const confirmed = await new Promise(resolve => {
            showConfirm(confirmBefore.message, () => resolve(true), confirmBefore.title, () => resolve(false));
        });
        if (!confirmed) return null;
    }

    try {
        showLoadingOverlay(loadingText);

        const result = await apiRequest(endpoint, data, { retries: true });

        if (result.success) {
            if (successMessage) {
                showNotification('success', successMessage);
            }

            if (shouldRefreshData) {
                // 觸發數據刷新
                const refreshEvent = new CustomEvent('dataRefreshNeeded', {
                    detail: { endpoint, data, result }
                });
                document.dispatchEvent(refreshEvent);
            }

            return result;
        } else {
            throw new Error(result.message || errorMessage);
        }

    } catch (error) {
        const finalErrorMessage = `${errorMessage}: ${error.message}`;
        showNotification('error', finalErrorMessage);
        throw error;

    } finally {
        hideLoadingOverlay();
    }
}

/**
 * 【新增】批次API操作
 */
export async function executeBatchApiActions(actions, options = {}) {
    const {
        loadingText = '批次處理中...',
        successMessage = '批次操作完成！',
        stopOnError = false,
        progressCallback = null
    } = options;

    showLoadingOverlay(loadingText);

    const results = [];
    const errors = [];

    try {
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            
            if (progressCallback) {
                progressCallback(i, actions.length, action);
            }

            try {
                const result = await apiRequest(action.endpoint, action.data, { retries: true });
                results.push({ ...action, result, success: true });
            } catch (error) {
                const errorResult = { ...action, error, success: false };
                results.push(errorResult);
                errors.push(errorResult);

                if (stopOnError) {
                    break;
                }
            }
        }

        if (errors.length === 0) {
            showNotification('success', successMessage);
        } else if (errors.length < actions.length) {
            showNotification('warning', `批次操作部分完成：${results.length - errors.length}/${actions.length} 成功`);
        } else {
            showNotification('error', '批次操作全部失敗');
        }

        return {
            success: errors.length === 0,
            results,
            errors,
            successCount: results.length - errors.length,
            totalCount: actions.length
        };

    } finally {
        hideLoadingOverlay();
    }
}

/**
 * 【新增】API健康檢查
 */
export async function checkApiHealth() {
    try {
        const startTime = Date.now();
        await apiRequest('health_check', {}, { retries: false });
        const responseTime = Date.now() - startTime;
        
        return {
            status: 'healthy',
            responseTime,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * 顯示載入覆蓋層
 */
function showLoadingOverlay(text = '處理中...') {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    if (overlay && loadingText) {
        loadingText.textContent = text;
        overlay.style.display = 'flex';
    }
}

/**
 * 隱藏載入覆蓋層
 */
function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

/**
 * 【新增】API統計信息
 */
export const ApiStats = {
    requests: 0,
    errors: 0,
    cacheHits: 0,
    averageResponseTime: 0,
    
    recordRequest(responseTime, success) {
        this.requests++;
        if (!success) this.errors++;
        
        this.averageResponseTime = (
            (this.averageResponseTime * (this.requests - 1)) + responseTime
        ) / this.requests;
    },

    recordCacheHit() {
        this.cacheHits++;
    },

    getStats() {
        return {
            totalRequests: this.requests,
            errorRate: this.requests > 0 ? (this.errors / this.requests) * 100 : 0,
            cacheHitRate: this.requests > 0 ? (this.cacheHits / this.requests) * 100 : 0,
            averageResponseTime: this.averageResponseTime,
            successRate: this.requests > 0 ? ((this.requests - this.errors) / this.requests) * 100 : 0
        };
    },

    reset() {
        this.requests = 0;
        this.errors = 0;
        this.cacheHits = 0;
        this.averageResponseTime = 0;
    }
};

// 初始化API系統
registerApiEndpoints();
apiRegistry.addMiddleware(loggingMiddleware);
apiRegistry.addMiddleware(cacheMiddleware);

// 數據刷新事件監聽器
document.addEventListener('dataRefreshNeeded', async (event) => {
    const { endpoint } = event.detail;
    
    // 根據不同的API端點觸發相應的數據重新載入
    if (endpoint.includes('group')) {
        const { loadGroups } = await import('./events/group.events.js');
        await loadGroups();
    }
    
    if (endpoint.includes('transaction')) {
        // 觸發交易數據重新載入
        const refreshTransactionEvent = new CustomEvent('refreshTransactions');
        document.dispatchEvent(refreshTransactionEvent);
    }
});

// 匯出API註冊表供其他模組使用
export { apiRegistry };

// 向後兼容性：匯出原有函數別名
export const makeApiRequest = apiRequest;
export const executeAction = executeApiAction;

console.log('[API] 群組交易管理API擴展已初始化');
