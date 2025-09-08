// =========================================================================================
// == 檔案：js/staging.service.js (v_arch_contract_fix_1)
// == 職責：提供並導出用於解析暫存區原始數據的服務函式，確立並履行其模組契約
// =========================================================================================

/**
 * 從原始文本數據中解析出結構化的交易紀錄。
 * 支援多種常見的券商對帳單格式。
 * @param {string} rawData - 從 textarea 輸入的原始文本
 * @returns {Array<object>} - 結構化的交易數據陣列
 * @throws {Error} - 當輸入格式無法識別或解析失敗時拋出錯誤
 */
function parseStagingData(rawData) {
    if (!rawData || typeof rawData !== 'string' || rawData.trim() === '') {
        return [];
    }

    const lines = rawData.trim().split('\n');
    const transactions = [];
    let detectedFormat = null;

    // 格式檢測器與對應的解析器
    const parsers = {
        // 範例格式 1: Tab 分隔，日期格式 YYYY/MM/DD
        // 日期\t代碼\t類型\t股數\t價格\t貨幣
        // 2023/10/15\tAAPL\tbuy\t10\t150.5\tUSD
        format1: {
            detector: (line) => /^\d{4}\/\d{2}\/\d{2}\t.+\t(buy|sell)\t[\d.]+\t[\d.]+\t[A-Z]{3}$/.test(line),
            parser: (line) => {
                const [dateStr, symbol, type, quantity, price] = line.split('\t');
                const [year, month, day] = dateStr.split('/');
                return {
                    date: `${year}-${month}-${day}`,
                    symbol: symbol.toUpperCase(),
                    type: type.toLowerCase(),
                    quantity: parseFloat(quantity),
                    price_per_share: parseFloat(price),
                    currency: 'USD' // 假設為 USD，或可從 line 中解析
                };
            }
        },
        // 範例格式 2: 逗號分隔，日期格式 MM-DD-YYYY
        // 10-15-2023,VOO,sell,5,400.2,USD
        format2: {
            detector: (line) => /^\d{2}-\d{2}-\d{4},.+\,(buy|sell)\,[\d.]+,.+/.test(line),
            parser: (line) => {
                const [dateStr, symbol, type, quantity, price, currency] = line.split(',');
                const [month, day, year] = dateStr.split('-');
                return {
                    date: `${year}-${month}-${day}`,
                    symbol: symbol.toUpperCase(),
                    type: type.toLowerCase(),
                    quantity: parseFloat(quantity),
                    price_per_share: parseFloat(price),
                    currency: currency.toUpperCase()
                };
            }
        },
        // 可在此處新增更多格式的檢測器與解析器...
    };

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (!detectedFormat) {
            for (const formatName in parsers) {
                if (parsers[formatName].detector(trimmedLine)) {
                    detectedFormat = formatName;
                    break;
                }
            }
        }
        
        if (detectedFormat && parsers[detectedFormat].detector(trimmedLine)) {
            try {
                transactions.push(parsers[detectedFormat].parser(trimmedLine));
            } catch (e) {
                console.error(`使用格式 [${detectedFormat}] 解析行失敗: "${trimmedLine}"`, e);
                throw new Error(`數據行格式錯誤: "${trimmedLine}"`);
            }
        } else {
             throw new Error(`無法識別的數據行格式: "${trimmedLine}"`);
        }
    }

    return transactions;
}

// 【核心修正】: 明確導出 parseStagingData 函式，以履行其模組契約
export {
    parseStagingData
};
