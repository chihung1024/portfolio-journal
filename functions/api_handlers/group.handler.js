// =========================================================================================
// == 檔案：functions/api_handlers/group.handler.js (v_api_cleanup_1)
// == 職責：處理所有與「群組」相關的 API 請求，提供健壯的 CRUD 功能
// =========================================================================================

const { d1Client } = require('../d1.client');
const { z } = require('zod');
// 注意：群組的變更僅影響數據分組視圖，不影響核心財務指標，因此無需觸發 performRecalculation。
// 前端在操作成功後，應自行調用 getPortfolio 以刷新數據。

const groupSchema = z.object({
  name: z.string().min(1, '群組名稱為必填項'),
  symbols: z.array(z.string()).optional().default([]),
});

/**
 * 新增一個群組
 * @param {object} c - Hono context object
 * @returns {Response}
 */
async function addGroup(c) {
    const uid = c.get('uid');
    const logPrefix = `[API|Group|${uid}]`;
    try {
        const body = await c.req.json();
        const validation = groupSchema.safeParse(body);
        if (!validation.success) {
            return c.json({ error: validation.error.flatten() }, 400);
        }
        const { name, symbols } = validation.data;
        
        await d1Client.query(
            'INSERT INTO `groups` (uid, name, symbols) VALUES (?, ?, ?)',
            [uid, name, JSON.stringify(symbols)]
        );
        
        console.log(`${logPrefix} 成功新增群組: ${name}`);
        return c.json({ success: true }, 201);
    } catch (e) {
        console.error(`${logPrefix} 新增群組時發生錯誤:`, e);
        return c.json({ error: '新增群組失敗' }, 500);
    }
}

/**
 * 更新一個現有的群組
 * @param {object} c - Hono context object
 * @returns {Response}
 */
async function updateGroup(c) {
    const uid = c.get('uid');
    const { id } = c.req.param();
    const logPrefix = `[API|Group|${uid}|ID:${id}]`;
    try {
        const body = await c.req.json();
        const validation = groupSchema.safeParse(body);
        if (!validation.success) {
            return c.json({ error: validation.error.flatten() }, 400);
        }
        const { name, symbols } = validation.data;

        await d1Client.query(
            'UPDATE `groups` SET name = ?, symbols = ? WHERE id = ? AND uid = ?',
            [name, JSON.stringify(symbols), id, uid]
        );
        
        console.log(`${logPrefix} 成功更新群組: ${name}`);
        return c.json({ success: true });
    } catch (e) {
        console.error(`${logPrefix} 更新群組時發生錯誤:`, e);
        return c.json({ error: '更新群組失敗' }, 500);
    }
}

/**
 * 刪除一個群組
 * @param {object} c - Hono context object
 * @returns {Response}
 */
async function deleteGroup(c) {
    const uid = c.get('uid');
    const { id } = c.req.param();
    const logPrefix = `[API|Group|${uid}|ID:${id}]`;
    try {
        await d1Client.query('DELETE FROM `groups` WHERE id = ? AND uid = ?', [id, uid]);
        
        console.log(`${logPrefix} 成功刪除群組`);
        return c.json({ success: true });
    } catch (e) {
        console.error(`${logPrefix} 刪除群組時發生錯誤:`, e);
        return c.json({ error: '刪除群組失敗' }, 500);
    }
}

module.exports = {
    addGroup,
    updateGroup,
    deleteGroup,
};
