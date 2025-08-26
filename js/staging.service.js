/**
 * @file staging.service.js
 * @description Manages a staging area for CUD operations using IndexedDB.
 * This service allows batching changes on the frontend before submitting them
 * to the backend, reducing API calls and improving user experience.
 */

const DB_NAME = 'PortfolioJournalStaging';
const DB_VERSION = 1;
const STORE_NAME = 'actions';

/**
 * Action Object Structure:
 * {
 *   id: string (uuid),
 *   type: 'CREATE' | 'UPDATE' | 'DELETE',
 *   entity: 'TRANSACTION' | 'DIVIDEND' | 'SPLIT' | 'GROUP',
 *   payload: object, // The data for the action
 *   timestamp: number // Timestamp of when the action was staged
 * }
 */

class StagingService {
  constructor() {
    this.db = null;
  }

  /**
   * Initializes the IndexedDB database.
   * Must be called before any other method.
   * @returns {Promise<void>}
   */
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

  /**
   * Adds an action to the staging store.
   * @param {{type: string, entity: string, payload: object}} actionData
   * @returns {Promise<IDBValidKey>}
   */
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

      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Retrieves all actions from the staging store.
   * @returns {Promise<Array<object>>}
   */
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

  /**
   * Updates an existing action in the staging store.
   * @param {string} id
   * @param {object} payload
   * @returns {Promise<IDBValidKey>}
   */
  async updateAction(id, payload) {
    if (!this.db) throw new Error('Database not initialized.');
    
    return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const action = getRequest.result;
            if (action) {
                action.payload = payload;
                action.timestamp = Date.now();
                const putRequest = store.put(action);
                putRequest.onsuccess = () => resolve(putRequest.result);
                putRequest.onerror = (event) => reject(event.target.error);
            } else {
                reject(new Error(`Action with id ${id} not found.`));
            }
        };
        getRequest.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Removes an action from the staging store by its ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async removeAction(id) {
    if (!this.db) throw new Error('Database not initialized.');

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Clears all actions from the staging store.
   * @returns {Promise<void>}
   */
  async clearActions() {
    if (!this.db) throw new Error('Database not initialized.');

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Calculates the net actions to be sent to the backend, canceling out redundant operations.
   * @returns {Promise<Array<object>>}
   */
  async getNetActions() {
    const allActions = await this.getActions();
    if (allActions.length === 0) {
      return [];
    }

    // Group actions by the actual entity ID from the payload
    const actionsByEntity = allActions.reduce((acc, action) => {
      const entityId = action.payload.id;
      if (!entityId) return acc; // Should not happen
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
        // If an item was created and then deleted, it's a wash.
        if (entityActions.some(a => a.type === 'DELETE')) {
          continue; // Skip this entity entirely
        }

        // If it was created and then updated, merge changes into one CREATE action
        const finalPayload = entityActions.reduce((payload, currentAction) => {
          if (currentAction.type === 'UPDATE') {
            // Merge the payload of the update into the create payload
            return { ...payload, ...currentAction.payload };
          }
          return payload;
        }, firstAction.payload);
        
        netActions.push({
            type: 'CREATE',
            entity: firstAction.entity,
            payload: finalPayload
        });

      } else { // This entity existed before staging (started with UPDATE or DELETE)
        
        // If it was deleted at any point, the net action is just DELETE.
        if (entityActions.some(a => a.type === 'DELETE')) {
          netActions.push({
            type: 'DELETE',
            entity: firstAction.entity,
            payload: { id: entityId } // Only ID is needed for deletion
          });
          continue;
        }

        // If it was only updated, merge all updates into one.
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

  /**
   * Submits all staged actions to the backend.
   * @returns {Promise<void>}
   */
  async submitAll() {
    if (!this.db) throw new Error('Database not initialized.');

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
        
        // Trigger a full data reload and UI refresh
        await loadPortfolioData();
      } else {
        throw new Error(result.message || '後端處理批次提交時發生錯誤。');
      }
    } catch (error) {
      console.error('Failed to submit actions:', error);
      showNotification('error', `提交失敗: ${error.message}`);
      // On failure, we don't clear the staging area, so the user can retry.
      throw error; // Re-throw so the caller knows it failed
    }
  }
}

// Export a singleton instance
export const stagingService = new StagingService();
