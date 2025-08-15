// =========================================================================================
// == 檔案：functions/api_handlers/group.handler.js (新增檔案)
// == 職責：處理所有與群組管理和按需計算相關的 API Action
// =========================================================================================

const { v4: uuidv4 } = require('uuid');
const { d1Client } = require('../d1.client');
const { runCalculationEngine } = require('../calculation/engine');

/**
 * 獲取使用者建立的所有群組
 */
exports.getGroups = async (uid, res) => {
    // 額外查詢每個群組包含了哪些股票
    const groupsResult = await d1Client.query('SELECT * FROM groups WHERE uid = ? ORDER BY created_at DESC', [uid]);
    const stockGroupsResult = await d1Client.query('SELECT symbol, group_id FROM stock_groups WHERE uid = ?', [uid]);

    const groupMap = {};
    groupsResult.forEach(group => {
        groupMap[group.id] = { ...group, symbols: [] };
    });

    stockGroupsResult.forEach(sg => {
        if (groupMap[sg.group_id]) {
            groupMap[sg.group_id].symbols.push(sg.symbol);
        }
    });

    return res.status(200).send({
        success: true,
        data: Object.values(groupMap)
    });
};

/**
 * 建立一個新的群組
 */
exports.saveGroup = async (uid, data, res) => {
    const { id, name, description, symbols } = data;
    const groupId = id || uuidv4();

    if (id) {
        // 更新現有群組
        await d1Client.query('UPDATE groups SET name = ?, description = ? WHERE id = ? AND uid = ?', [name, description, id, uid]);
    } else {
        // 新增群組
        await d1Client.query('INSERT INTO groups (id, uid, name, description) VALUES (?, ?, ?, ?)', [groupId, uid, name, description]);
    }

    // 更新群組與股票的關聯
    await d1Client.query('DELETE FROM stock_groups WHERE uid = ? AND group_id = ?', [uid, groupId]);
    if (symbols && symbols.length > 0) {
        const stockGroupOps = symbols.map(symbol => ({
            sql: 'INSERT INTO stock_groups (uid, symbol, group_id) VALUES (?, ?, ?)',
            params: [uid, symbol.toUpperCase(), groupId]
        }));
        await d1Client.batch(stockGroupOps);
    }

    return res.status(200).send({ success: true, message: '群組已儲存。', groupId });
};

/**
 * 刪除一個群組
 */
exports.deleteGroup = async (uid, data, res) => {
    const { groupId } = data;
    // 由於設定了 ON DELETE CASCADE，關聯表 stock_groups 的紀錄會被自動刪除
    await d1Client.query('DELETE FROM groups WHERE id = ? AND uid = ?', [groupId, uid]);
    return res.status(200).send({ success: true, message: '群組已刪除。' });
};


/**
 * 按需計算指定群組的投資組合狀態（一次性，不儲存）
 */
exports.calculateGroupOnDemand = async (uid, data, res) => {
    const { groupId } = data;
    if (!groupId) {
        return res.status(400).send({ success: false, message: '缺少 groupId。' });
    }

    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 按需計算程序開始 ---`);

    // 1. 根據 groupId 撈取群組內的股票代碼
    const groupSymbolsResult = await d1Client.query('SELECT symbol FROM stock_groups WHERE uid = ? AND group_id = ?', [uid, groupId]);
    if (groupSymbolsResult.length === 0) {
        // 如果群組是空的，直接回傳空結果
        return res.status(200).send({ success: true, data: { holdings: [], summary: {}, history: {}, twrHistory: {}, netProfitHistory: {}, benchmarkHistory: {} } });
    }
    const symbolsInGroup = groupSymbolsResult.map(s => s.symbol.toUpperCase());
    const placeholders = symbolsInGroup.map(() => '?').join(',');

    // 2. 撈取計算所需的【全域】母數據，並在稍後進行過濾
    const [allSplits, allUserDividends, controlsData] = await Promise.all([
        d1Client.query('SELECT * FROM splits WHERE uid = ?', [uid]),
        d1Client.query('SELECT * FROM user_dividends WHERE uid = ?', [uid]),
        d1Client.query('SELECT value FROM controls WHERE uid = ? AND key = ?', [uid, 'benchmarkSymbol'])
    ]);

    // 3. 【核心修正】只撈取與群組內股票相關的交易、拆股和股利紀錄
    const txs = await d1Client.query(`SELECT * FROM transactions WHERE uid = ? AND symbol IN (${placeholders}) ORDER BY date ASC`, [uid, ...symbolsInGroup]);
    const splitsInGroup = allSplits.filter(split => symbolsInGroup.includes(split.symbol.toUpperCase()));
    const dividendsInGroup = allUserDividends.filter(dividend => symbolsInGroup.includes(dividend.symbol.toUpperCase()));
    
    const benchmarkSymbol = controlsData.length > 0 ? controlsData[0].value : 'SPY';

    // 4. 呼叫計算引擎，傳入【已過濾】的數據
    const result = await runCalculationEngine(
        txs,
        splitsInGroup,
        dividendsInGroup,
        benchmarkSymbol
    );
    
    // 5. 將計算結果直接打包回傳
    const responseData = {
        holdings: Object.values(result.holdingsToUpdate),
        summary: result.summaryData,
        history: result.fullHistory,
        twrHistory: result.twrHistory,
        benchmarkHistory: result.benchmarkHistory,
        netProfitHistory: result.netProfitHistory,
    };

    console.log(`--- [${uid}|G:${groupId.substring(0,4)}] 按需計算程序完成 ---`);
    return res.status(200).send({ success: true, data: responseData });
};
