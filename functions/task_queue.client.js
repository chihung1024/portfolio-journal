// =========================================================================================
// == 檔案：functions/task_queue.client.js (新檔案)
// == 職責：封裝與 Google Cloud Tasks 的互動，提供一個簡單的 enqueueTask 函式。
// =========================================================================================

const { CloudTasksClient } = require('@google-cloud/tasks');

// 初始化 Cloud Tasks 客戶端
const client = new CloudTasksClient();

// 從環境變數讀取配置 (需要在 Cloud Function 設定中配置這些變數)
const PROJECT = process.env.GCP_PROJECT;
const LOCATION = process.env.FUNCTION_REGION; // e.g., 'asia-east1'
const QUEUE = process.env.RECALCULATION_QUEUE; // e.g., 'recalculation-queue'
// 【重要】這是你的背景 Worker 函式的觸發 URL，我們稍後會建立它
const WORKER_URL = process.env.RECALCULATION_WORKER_URL; 
// 用於服務間安全驗證的金鑰
const SERVICE_ACCOUNT_KEY = process.env.SERVICE_ACCOUNT_KEY;

/**
 * 將一個任務推送到背景佇列中
 * @param {string} workerName - 要執行的背景工作者名稱, e.g., 'postTransactionWorker'
 * @param {object} payload - 要傳遞給背景工作者的資料, e.g., { uid, symbol, txDate }
 */
async function enqueueTask(workerName, payload) {
    if (!PROJECT || !LOCATION || !QUEUE || !WORKER_URL) {
        console.error("Cloud Tasks 配置不完整，無法觸發背景任務。");
        // 拋出錯誤，讓上層知道任務分派失敗
        throw new Error("Task queue service is not configured.");
    }

    const parent = client.queuePath(PROJECT, LOCATION, QUEUE);
    const taskPayload = { workerName, payload };

    const task = {
        httpRequest: {
            httpMethod: 'POST',
            url: WORKER_URL,
            headers: {
                'Content-Type': 'application/json',
                // 使用一個金鑰來驗證此請求確實來自你自己的服務
                'X-Internal-Service-Key': SERVICE_ACCOUNT_KEY 
            },
            body: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
        }
    };

    try {
        console.log(`[${payload.uid}] 正在將 ${workerName} 任務推送到佇列...`);
        const [response] = await client.createTask({ parent, task });
        console.log(`[${payload.uid}] 任務 ${response.name} 已成功建立。`);
    } catch (error) {
        console.error(`[${payload.uid}] 建立 Cloud Task 失敗:`, error);
        throw error; // 將錯誤向上拋出
    }
}

module.exports = { enqueueTask };
