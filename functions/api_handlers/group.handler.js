const { z } = require("zod");
const { getDb } = require("../d1.client");
const { groupSchema, groupIdSchema, updateGroupMembersSchema } = require("../schemas");
const { runCalculationEngine } = require("../calculation/engine");

/**
 * 獲取所有群組的基本資訊
 * @param {object} req - Express請求物件
 * @param {object} res - Express回應物件
 */
exports.getGroups = async (req, res) => {
    const { uid } = req.user;
    try {
        const db = getDb();
        const { results } = await db
            .prepare(
                `
                SELECT 
                    g.id, 
                    g.name, 
                    g.description, 
                    g.is_dirty,
                    COUNT(DISTINCT t.symbol) as unique_symbols_count,
                    COUNT(tgm.transaction_id) as transactions_count
                FROM groups g
                LEFT JOIN transaction_group_memberships tgm ON g.id = tgm.group_id
                LEFT JOIN transactions t ON tgm.transaction_id = t.id AND t.uid = ?1
                WHERE g.uid = ?1
                GROUP BY g.id, g.name, g.description, g.is_dirty
                ORDER BY g.created_at DESC
                `
            )
            .bind(uid)
            .all();
        res.status(200).json(results);
    } catch (error) {
        console.error("Error fetching groups:", error);
        res.status(500).json({
            message: "無法獲取群組列表",
            error: error.message,
        });
    }
};

/**
 * 儲存（新增或更新）一個群組
 * @param {object} req - Express請求物件
 * @param {object} res - Express回應物件
 */
exports.saveGroup = async (req, res) => {
    const { uid } = req.user;
    const { id, name, description } = groupSchema.parse(req.body);

    try {
        const db = getDb();
        if (id) {
            // 更新現有群組
            await db
                .prepare("UPDATE groups SET name = ?, description = ? WHERE id = ? AND uid = ?")
                .bind(name, description || null, id, uid)
                .run();
            res.status(200).json({ message: "群組已更新", id });
        } else {
            // 新增群組
            const { meta } = await db
                .prepare("INSERT INTO groups (uid, name, description) VALUES (?, ?, ?)")
                .bind(uid, name, description || null)
                .run();
            const lastId = meta.last_row_id;
            res.status(201).json({ message: "群組已建立", id: lastId });
        }
    } catch (error) {
        console.error("Error saving group:", error);
        res.status(500).json({ message: "儲存群組失敗", error: error.message });
    }
};

/**
 * 刪除一個群組
 * @param {object} req - Express請求物件
 * @param {object} res - Express回應物件
 */
exports.deleteGroup = async (req, res) => {
    const { uid } = req.user;
    const { id } = groupIdSchema.parse(req.body);

    try {
        const db = getDb();
        // 使用交易來確保資料一致性
        await db.batch([
            db.prepare("DELETE FROM transaction_group_memberships WHERE group_id = ? AND EXISTS (SELECT 1 FROM groups WHERE id = ? AND uid = ?)"),
            db.prepare("DELETE FROM groups WHERE id = ? AND uid = ?"),
        ]);

        // 執行批次操作
        await db.batch([
            db.prepare("DELETE FROM transaction_group_memberships WHERE group_id = ?").bind(id),
            db.prepare("DELETE FROM groups WHERE id = ? AND uid = ?").bind(id, uid),
        ]);

        res.status(200).json({ message: "群組已刪除" });
    } catch (error) {
        console.error("Error deleting group:", error);
        res.status(500).json({ message: "刪除群組失敗", error: error.message });
    }
};

/**
 * 按需計算特定群組的投資組合數據
 * @param {object} req - Express請求物件
 * @param {object} res - Express回應物件
 */
exports.calculateGroupOnDemand = async (req, res) => {
    const { uid } = req.user;
    const { groupId } = z.object({ groupId: z.number().int() }).parse(req.body);

    try {
        const db = getDb();
        // 檢查群組是否存在且屬於該使用者
        const group = await db.prepare("SELECT * FROM groups WHERE id = ? AND uid = ?").bind(groupId, uid).first();
        if (!group) {
            return res.status(404).json({ message: "找不到指定的群組" });
        }

        // 檢查快取
        if (!group.is_dirty) {
            const cachedResult = await db.prepare("SELECT result FROM group_cache WHERE group_id = ?").bind(groupId).first("result");
            if (cachedResult) {
                return res.status(200).json(JSON.parse(cachedResult));
            }
        }

        // 快取未命中或已髒，執行重新計算
        const transactions = await db
            .prepare(
                `
                SELECT t.* FROM transactions t
                JOIN transaction_group_memberships tgm ON t.id = tgm.transaction_id
                WHERE tgm.group_id = ? AND t.uid = ?
                `
            )
            .bind(groupId, uid)
            .all()
            .then((res) => res.results);

        // 如果群組內沒有任何交易，回傳一個空的 portfolio 結構
        if (transactions.length === 0) {
            const emptyPortfolio = {
                summary: {},
                holdings: [],
                history: [{ date: new Date().toISOString().slice(0, 10), totalValue: 0 }],
                performance: {},
                realizedFIFO: [],
                twr: [],
                metadata: { calculationDate: new Date().toISOString() },
            };
            return res.status(200).json(emptyPortfolio);
        }

        // 從群組交易中提取所有唯一的股票代碼
        const symbols = [...new Set(transactions.map((t) => t.symbol))];

        const [dividends, splits] = await Promise.all([
            db.prepare(`SELECT * FROM dividends WHERE uid = ? AND symbol IN (${symbols.map(() => "?").join(",")})`).bind(uid, ...symbols).all().then((res) => res.results),
            db.prepare(`SELECT * FROM splits WHERE uid = ? AND symbol IN (${symbols.map(() => "?").join(",")})`).bind(uid, ...symbols).all().then((res) => res.results),
        ]);

        const portfolio = await runCalculationEngine(uid, transactions, dividends, splits);

        // 更新快取並將 is_dirty 設為 false
        const resultJson = JSON.stringify(portfolio);
        await db
            .prepare("INSERT OR REPLACE INTO group_cache (group_id, result, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)")
            .bind(groupId, resultJson)
            .run();
        await db.prepare("UPDATE groups SET is_dirty = 0 WHERE id = ?").bind(groupId).run();

        res.status(200).json(portfolio);
    } catch (error) {
        console.error(`Error calculating group ${groupId} on demand:`, error);
        res.status(500).json({ message: "計算群組數據失敗", error: error.message });
    }
};

/**
 * [新增] 獲取用於成員管理的交易列表（群組內 vs 群組外）
 * @param {object} req - Express請求物件
 * @param {object} res - Express回應物件
 */
exports.getGroupMembersForEditing = async (req, res) => {
    const { uid } = req.user;
    const { groupId } = z.object({ groupId: z.number().int() }).parse(req.body);

    try {
        const db = getDb();
        // 1. 獲取該使用者所有的交易
        const allTransactions = await db.prepare("SELECT id, date, symbol, action, quantity, price FROM transactions WHERE uid = ? ORDER BY date DESC").bind(uid).all().then((r) => r.results);

        // 2. 獲取當前群組的所有成員交易ID
        const memberTransactionIds = await db
            .prepare("SELECT transaction_id FROM transaction_group_memberships WHERE group_id = ?")
            .bind(groupId)
            .all()
            .then((r) => new Set(r.results.map((row) => row.transaction_id)));

        // 3. 將所有交易分為兩組
        const members = [];
        const nonMembers = [];
        for (const tx of allTransactions) {
            if (memberTransactionIds.has(tx.id)) {
                members.push(tx);
            } else {
                nonMembers.push(tx);
            }
        }

        res.status(200).json({ members, nonMembers });
    } catch (error) {
        console.error(`Error fetching group members for editing for group ${groupId}:`, error);
        res.status(500).json({ message: "獲取群組成員失敗", error: error.message });
    }
};

/**
 * [新增] 更新群組的成員列表
 * @param {object} req - Express請求物件
 * @param {object} res - Express回應物件
 */
exports.updateGroupMembers = async (req, res) => {
    const { uid } = req.user;
    const { groupId, additions, removals } = updateGroupMembersSchema.parse(req.body);

    try {
        const db = getDb();

        // 驗證群組是否屬於該使用者
        const group = await db.prepare("SELECT id FROM groups WHERE id = ? AND uid = ?").bind(groupId, uid).first();
        if (!group) {
            return res.status(403).json({ message: "權限不足或群組不存在" });
        }

        // 使用批次操作確保原子性
        const statements = [];

        // 1. 建立刪除成員的 statements
        if (removals && removals.length > 0) {
            const deleteStmt = db.prepare(`DELETE FROM transaction_group_memberships WHERE group_id = ? AND transaction_id IN (${removals.map(() => "?").join(",")})`);
            statements.push(deleteStmt.bind(groupId, ...removals));
        }

        // 2. 建立新增成員的 statements
        if (additions && additions.length > 0) {
            const insertStmt = db.prepare(`INSERT OR IGNORE INTO transaction_group_memberships (group_id, transaction_id) VALUES ${additions.map(() => "(?, ?)").join(",")}`);
            const bindings = additions.flatMap((txId) => [groupId, txId]);
            statements.push(insertStmt.bind(...bindings));
        }

        // 3. 將群組標記為 dirty
        statements.push(db.prepare("UPDATE groups SET is_dirty = 1 WHERE id = ?").bind(groupId));

        // 執行所有資料庫操作
        if (statements.length > 0) {
            await db.batch(statements);
        }

        res.status(200).json({ message: "群組成員已成功更新" });
    } catch (error) {
        console.error(`Error updating group members for group ${groupId}:`, error);
        res.status(500).json({ message: "更新群組成員失敗", error: error.message });
    }
};
