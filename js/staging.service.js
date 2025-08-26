import { submitBatch, loadPortfolioData, getPortfolioTimestamp } from './api.js';
import { showNotification } from './ui/notifications.js';
import { updateDashboardStaleIndicators } from './ui/dashboard.js';
import { getState } from './state.js';
import { showConfirm } from './ui/modals.js';

/**
 * @file staging.service.js
 * @description Manages a staging area for CUD operations using IndexedDB.
 */

const DB_NAME = 'PortfolioJournalStaging';
const DB_VERSION = 1;
const STORE_NAME = 'actions';

class StagingService {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        return resolve();
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('Staging database initialized successfully.');
        resolve();
      };
      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.errorCode);
        reject(event.target.error);
      };
    });
  }

  async addAction({ type, entity, payload }) {
    if (!this.db) throw new Error('Database not initialized.');
    const action = {
      id: self.crypto.randomUUID(),
      type,
      entity,
      payload,
      timestamp: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(action);
      request.onsuccess = () => {
        resolve(request.result);
        updateDashboardStaleIndicators();
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async getActions() {
    if (!this.db) throw new Error('Database not initialized.');
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async removeAction(id) {
    if (!this.db) throw new Error('Database not initialized.');
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => {
        resolve();
        updateDashboardStaleIndicators();
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async clearActions() {
    if (!this.db) throw new Error('Database not initialized.');
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => {
        resolve();
        updateDashboardStaleIndicators();
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async getNetActions() {
    const allActions = await this.getActions();
    if (allActions.length === 0) {
      return [];
    }
    const actionsByEntity = allActions.reduce((acc, action) => {
      const entityId = action.payload.id;
      if (!entityId) return acc;
      if (!acc[entityId]) {
        acc[entityId] = [];
      }
      acc[entityId].push(action);
      return acc;
    }, {});
    const netActions = [];
    for (const entityId in actionsByEntity) {
      const entityActions = actionsByEntity[entityId].sort((a, b) => a.timestamp - b.timestamp);
      const firstAction = entityActions[0];
      if (firstAction.type === 'CREATE') {
        if (entityActions.some(a => a.type === 'DELETE')) {
          continue;
        }
        const finalPayload = entityActions.reduce((payload, currentAction) => {
          if (currentAction.type === 'UPDATE') {
            return { ...payload, ...currentAction.payload };
          }
          return payload;
        }, firstAction.payload);
        netActions.push({
            type: 'CREATE',
            entity: firstAction.entity,
            payload: finalPayload
        });
      } else {
        if (entityActions.some(a => a.type === 'DELETE')) {
          netActions.push({
            type: 'DELETE',
            entity: firstAction.entity,
            payload: { id: entityId }
          });
          continue;
        }
        const finalPayload = entityActions.reduce((payload, currentAction) => {
            return { ...payload, ...currentAction.payload };
        }, {});
        netActions.push({
            type: 'UPDATE',
            entity: firstAction.entity,
            payload: { id: entityId, ...finalPayload }
        });
      }
    }
    return netActions;
  }

  async submitAll() {
    if (!this.db) throw new Error('Database not initialized.');

    // Step 1: Conflict Check
    try {
        const { timestamp: serverTimestamp } = await getPortfolioTimestamp();
        const { dataTimestamp: localTimestamp } = getState();

        if (localTimestamp && serverTimestamp && new Date(serverTimestamp) > new Date(localTimestamp)) {
            const userConfirmed = await new Promise(resolve => {
                showConfirm(
                    '資料在您編輯期間已被更新，若繼續提交可能會覆蓋他人變更。建議您先取消並刷新頁面。是否仍要強制提交？',
                    () => resolve(true),  // onConfirm
                    () => resolve(false) // onCancel
                );
            });

            if (!userConfirmed) {
                showNotification('info', '提交已取消。');
                return; // Abort submission
            }
        }
    } catch (error) {
        showNotification('error', `檢查資料版本失敗: ${error.message}`);
        return; // Abort on check failure
    }

    // Step 2: Proceed with submission
    const netActions = await this.getNetActions();
    if (netActions.length === 0) {
      showNotification('info', '暫存區是空的，沒有需要提交的內容。');
      return;
    }

    try {
      const result = await submitBatch(netActions);
      if (result.success) {
        await this.clearActions();
        showNotification('success', '變更已成功提交！正在刷新資料...');
        await loadPortfolioData();
      } else {
        throw new Error(result.message || '後端處理批次提交時發生錯誤。');
      }
    } catch (error) {
      console.error('Failed to submit actions:', error);
      showNotification('error', `提交失敗: ${error.message}`);
      throw error;
    }
  }
}

export const stagingService = new StagingService();