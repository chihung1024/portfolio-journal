// =========================================================================================
// == 檔案：functions/task_queue.client.js (新增)
// == 職責：封裝與背景任務佇列服務 (Google Cloud Tasks) 的互動。
// =========================================================================================

const { CloudTasksClient } = require('@google-cloud/tasks');

// 初始化 Cloud Tasks 客戶端
const client = new CloudTasksClient();

// 從環境變數讀取配置（需要在 Cloud Function 設定中配置這些變數）
const PROJECT = process.env.GCP_PROJECT;
const LOCATION = process.env.FUNCTION_REGION; // e.g., 'asia-east1'
const QUEUE = process.env.RECALCULATION_QUEUE; // e.g., 'recalculation-queue'
// 你的背景任務處理函式的 URL
const WORKER_URL = process.env.RECALCULATION_WORKER_URL; 
// 用於服務間驗證的金鑰
const SERVICE_ACCOUNT_KEY = process.env.SERVICE_ACCOUNT_KEY;

/**
 * 觸發一個背景計算任務
 * @param {string} taskType - 任務類型, e.g., 'performRecalculation'
 * @param {object} payload - 要傳遞給背景任務的資料, e.g., { uid, modifiedTxDate }
 */
exports.triggerBackgroundTask = async (taskType, payload) => {
    if (!PROJECT || !LOCATION || !QUEUE || !WORKER_URL) {
        console.error("Cloud Tasks 配置不完整，無法觸發背景任務。將降級為同步執行。");
        // 降級處理：如果沒有設定佇列，可以直接在本地呼叫，但會失去非同步的好處
        // const { performRecalculation } = require('./performRecalculation');
        // await performRecalculation(payload.uid, payload.modifiedTxDate);
        return;
    }

    const parent = client.queuePath(PROJECT, LOCATION, QUEUE);

    const task = {
        httpRequest: {
            httpMethod: 'POST',
            url: WORKER_URL,
            headers: {
                'Content-Type': 'application/json',
                // 使用一個安全的金鑰來驗證請求來自於你自己的服務
                'X-Internal-Service-Key': SERVICE_ACCOUNT_KEY 
            },
            body: Buffer.from(JSON.stringify({ taskType, payload })).toString('base64'),
        },
        // 為任務命名，利用 Cloud Tasks 的去重功能
        // 在 10 分鐘內，同名任務只會被執行一次，避免因重試導致的重複計算
        name: `${parent}/tasks/recalc-${payload.uid}-${Date.now()}`,
        dispatchDeadline: {
            seconds: 60 * 10, // 任務必須在 10 分鐘內開始
        },
    };

    try {
        console.log(`[${payload.uid}] 正在將 ${taskType} 任務推送到佇列...`);
        const [response] = await client.createTask({ parent, task });
        console.log(`[${payload.uid}] 任務 ${response.name} 已成功建立。`);
    } catch (error) {
        console.error(`[${payload.uid}] 建立 Cloud Task 失敗:`, error);
        // 在這裡可以加入失敗時的備用處理邏輯，例如記錄到日誌或資料庫中
    }
};

// 注意：你需要另外建立一個 HTTP-triggered Cloud Function 來接收和處理來自這個佇列的任務。
// 該函式的主體就是呼叫 performRecalculation 函式。
