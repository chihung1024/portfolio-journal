// =========================================================================================
// == 檔案：functions/backgroundWorker.js (新檔案)
// =========================================================================================
const functions = require("firebase-functions");
const { postTransactionWorker } = require('./postTransactionWorker');

exports.backgroundTaskHandler = functions.region('asia-east1').https.onRequest(async (req, res) => {
    // 步驟 1: 安全驗證
    // 確保請求來自 Cloud Tasks，而不是任意的公開請求
    const internalServiceKey = req.headers['x-internal-service-key'];
    if (internalServiceKey !== process.env.SERVICE_ACCOUNT_KEY) {
        console.error('無效的內部服務金鑰。');
        return res.status(403).send('Unauthorized');
    }

    try {
        // 步驟 2: 解析任務
        const body = JSON.parse(Buffer.from(req.body, 'base64').toString());
        const { workerName, payload } = body;

        console.log(`收到背景任務: ${workerName}，Payload:`, payload);

        // 步驟 3: 根據任務名稱，分派給對應的 Worker 邏輯
        switch (workerName) {
            case 'postTransactionWorker':
                await postTransactionWorker(payload);
                break;
            default:
                console.error(`未知的 Worker 名稱: ${workerName}`);
                return res.status(400).send('Unknown worker name');
        }

        // 步驟 4: 成功完成，回傳 200 OK 告知 Cloud Tasks
        return res.status(200).send('Task completed successfully.');

    } catch (error) {
        console.error('背景 Worker 執行失敗:', error);
        // 回傳 500 錯誤，告知 Cloud Tasks 任務失敗，需要重試
        return res.status(500).send('Task failed');
    }
});
