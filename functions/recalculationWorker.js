const functions = require("firebase-functions");
const { performRecalculation } = require('./calculationEngine');

/**
 * 此函式由 Pub/Sub 主題 'recalculation-topic' 的新訊息觸發。
 * 它的唯一職責是為訊息中指定的 UID 執行重算。
 */
exports.processRecalculationTask = functions
    .runWith({
        timeoutSeconds: 540, // 可為長時間運行的計算設定更長的超時
        memory: '1GB'      // 可根據需要分配更多記憶體
    })
    .region('asia-east1')
    .pubsub.topic('recalculation-topic')
    .onPublish(async (message, context) => {
        
        const uid = Buffer.from(message.data, 'base64').toString('utf-8');
        
        if (!uid) {
            console.error("收到的 Pub/Sub 訊息中缺少有效的 UID，任務終止。", { messageId: context.eventId });
            return;
        }

        console.log(`[Worker] 開始為使用者 ${uid} 執行重算任務 (Event ID: ${context.eventId})...`);

        try {
            await performRecalculation(uid);
            console.log(`[Worker] 使用者 ${uid} 的重算任務成功完成。`);
        } catch (error) {
            console.error(`[Worker] 為使用者 ${uid} 執行重算時發生嚴重錯誤:`, error);
            // 向上拋出錯誤，讓 Cloud Functions / Pub/Sub 根據其重試策略進行處理
            // 您可以在 GCP Console 的函式設定中配置重試行為
            throw new Error(`Recalculation failed for UID: ${uid}`);
        }
    });
