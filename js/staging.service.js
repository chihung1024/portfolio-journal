// =========================================================================================
// == 暫存區核心服務 (staging.service.js) - 【新檔案】
// == 職責：使用 IndexedDB 管理操作隊列，計算淨操作，並在狀態變更時發出通知。
// =========================================================================================

const DB_NAME = 'PortfolioStagingDB';
const DB_VERSION = 1;
const STORE_NAME = 'actions';

class StagingService {
    constructor() {
        this.db = null;
    }

    /**
     * 初始化 IndexedDB 資料庫
     */
    async init() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log("Staging DB initialized successfully.");
                this.notifyUpdate();
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    /**
     * 向暫存區新增一個操作
     * @param {'CREATE'|'UPDATE'|'DELETE'} type - 操作類型
     * @param {'transaction'|'split'|'dividend'|'group'} entity - 操作的實體類型
     * @param {object} payload - 操作的數據
     */
    async addAction(type, entity, payload) {
        if (!this.db) await this.init();
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // 為每個操作加上時間戳，便於追蹤
        const action = { type, entity, payload, timestamp: new Date() };

        return new Promise((resolve, reject) => {
            const request = store.add(action);
            request.onsuccess = () => {
                this.notifyUpdate();
                resolve(true);
            };
            request.onerror = (event) => {
                console.error('Failed to add action to staging area:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * 獲取所有原始的暫存操作
     * @returns {Promise<Array>}
     */
    async getStagedActions() {
        if (!this.db) await this.init();
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    /**
     * 【核心邏輯】計算淨操作
     * @returns {Promise<Array>} - 可以直接發送到後端的最小化操作陣列
     */
    async getNetActions() {
        const allActions = await this.getStagedActions();
        const netActionsMap = new Map();

        for (const action of allActions) {
            const { entity, payload } = action;
            const entityId = payload.id; // 假設所有 payload 都有 id

            if (!entityId) continue; // 忽略沒有 ID 的操作

            const existing = netActionsMap.get(entityId);

            switch (action.type) {
                case 'CREATE':
                    // 如果一個項目被創建，它就成為 Map 中的基礎
                    netActionsMap.set(entityId, action);
                    break;
                case 'UPDATE':
                    if (existing) {
                        if (existing.type === 'CREATE' || existing.type === 'UPDATE') {
                            // 如果之前是創建或更新，則合併 payload
                            existing.payload = { ...existing.payload, ...payload };
                        }
                        // 如果之前是刪除，則忽略此更新
                    } else {
                        // 如果不存在，則將其視為一個新的更新操作
                        netActionsMap.set(entityId, action);
                    }
                    break;
                case 'DELETE':
                    if (existing) {
                        if (existing.type === 'CREATE') {
                            // 如果是新創建的項目被刪除，則直接從 Map 中移除，操作相互抵銷
                            netActionsMap.delete(entityId);
                        } else {
                            // 如果是已存在的項目被刪除，則將操作改為 DELETE
                            existing.type = 'DELETE';
                            // 可以選擇性地保留 id，清除其他 payload
                            existing.payload = { id: entityId }; 
                        }
                    } else {
                        // 如果不存在，則新增一個刪除操作
                        netActionsMap.set(entityId, action);
                    }
                    break;
            }
        }
        
        // 從 Map 中提取最終的操作陣列
        return Array.from(netActionsMap.values());
    }
    
    /**
     * 根據 IndexedDB 的主鍵 ID 移除一個操作
     * @param {number} actionId 
     */
    async removeAction(actionId) {
        if (!this.db) await this.init();
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        return new Promise((resolve, reject) => {
            const request = store.delete(actionId);
            request.onsuccess = () => {
                this.notifyUpdate();
                resolve(true);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    /**
     * 清空所有暫存操作
     */
    async clearActions() {
        if (!this.db) await this.init();
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => {
                this.notifyUpdate();
                resolve(true);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    /**
     * 發送一個全局事件，通知 UI 暫存區已更新
     */
    async notifyUpdate() {
        const actions = await this.getStagedActions();
        const event = new CustomEvent('staging-area-updated', {
            detail: { count: actions.length }
        });
        document.dispatchEvent(event);
    }
}

// 導出單例
export const stagingService = new StagingService();