// =========================================================================================
// == 檔案：functions/api_handlers/migration.handler.js (新增檔案)
// == 職責：處理一次性的資料庫遷移任務
// =========================================================================================

const { d1Client } = require('../d1.client');

/**
 * 執行從 stock_groups 到 group_transaction_inclusions 的數據遷移
 */
exports.runMigration = async (req, res) => {
    console.log("--- 開始執行 v3 數據庫遷移腳本 ---");
    try {
        // 步驟 1: 獲取所有需要遷移的使用者及其舊的、基於股票代碼的群組定義
        console.log("步驟 1/5: 正在讀取舊的群組定義...");
        const oldGroupDefinitions = await d1Client.query(`
            SELECT g.uid, g.id as group_id, sg.symbol
            FROM groups g
            JOIN stock_groups_deprecated sg ON g.id = sg.group_id
        `);
        if (oldGroupDefinitions.length === 0) {
            console.log("沒有找到任何舊的群組定義，無需遷移。");
            return res.status(200).send({ success: true, message: '沒有需要遷移的數據。' });
        }
        console.log(`找到 ${oldGroupDefinitions.length} 條舊的群組-股票關聯紀錄。`);

        // 步驟 2: 獲取所有使用者的所有交易紀錄，以供後續匹配
        console.log("步驟 2/5: 正在讀取所有交易紀錄...");
        const allUserTransactions = await d1Client.query(`SELECT id, uid, symbol FROM transactions`);
        console.log(`共找到 ${allUserTransactions.length} 筆交易紀錄。`);

        // 步驟 3: 為了高效查找，在記憶體中構建一個 "使用者ID_股票代碼" -> [交易ID列表] 的映射
        console.log("步驟 3/5: 正在記憶體中建立查找映射...");
        const transactionMap = {}; 
        for (const tx of allUserTransactions) {
            const key = `${tx.uid}_${tx.symbol.toUpperCase()}`;
            if (!transactionMap[key]) {
                transactionMap[key] = [];
            }
            transactionMap[key].push(tx.id);
        }
        console.log("映射建立完成。");

        // 步驟 4: 遍歷舊的定義，生成所有需要寫入新表的 INSERT 語句
        console.log("步驟 4/5: 正在生成新的 inclusion 紀錄...");
        const insertStatements = [];
        for (const oldDef of oldGroupDefinitions) {
            const key = `${oldDef.uid}_${oldDef.symbol.toUpperCase()}`;
            const transactionIds = transactionMap[key] || [];
            for (const txId of transactionIds) {
                // 使用 INSERT OR IGNORE 確保冪等性，即使腳本重跑也不會出錯
                insertStatements.push({
                    sql: 'INSERT OR IGNORE INTO group_transaction_inclusions (group_id, transaction_id, uid) VALUES (?, ?, ?)',
                    params: [oldDef.group_id, txId, oldDef.uid]
                });
            }
        }
        console.log(`共生成 ${insertStatements.length} 筆新的 inclusion 紀錄。`);
        
        // 步驟 5: 使用 D1 的 batch 功能，原子性地一次性寫入所有數據
        if (insertStatements.length > 0) {
            console.log("步驟 5/5: 正在將新紀錄批次寫入資料庫...");
            await d1Client.batch(insertStatements);
            console.log("批次寫入成功！");
        } else {
            console.log("步驟 5/5: 沒有需要寫入的新紀錄。");
        }

        console.log("--- v3 數據庫遷移腳本執行成功 ---");
        return res.status(200).send({ success: true, message: `遷移成功，共處理了 ${insertStatements.length} 筆交易歸屬紀錄。` });

    } catch (error) {
        console.error("遷移過程中發生嚴重錯誤:", error);
        throw error; // 讓上層的 try-catch 捕捉並回傳 500 錯誤
    }
};
