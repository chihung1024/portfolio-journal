// =========================================================================================
// == 檔案：functions/schemas.js (v2.0 - Staging Area Expansion)
// =========================================================================================

const { z } = require("zod");

const transactionSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    symbol: z.string().min(1).transform(val => val.toUpperCase().trim()),
    type: z.enum(['buy', 'sell']),
    quantity: z.number().positive(),
    price: z.number().positive(),
    currency: z.enum(['USD', 'TWD', 'HKD', 'JPY']),
    totalCost: z.number().positive().optional().nullable(),
    exchangeRate: z.number().positive().optional().nullable(),
});

const splitSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    symbol: z.string().min(1).transform(val => val.toUpperCase().trim()),
    ratio: z.number().positive(),
});

const userDividendSchema = z.object({
    id: z.string().uuid().optional(),
    symbol: z.string(),
    ex_dividend_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantity_at_ex_date: z.number(),
    amount_per_share: z.number(),
    total_amount: z.number(),
    tax_rate: z.number().min(0).max(100),
    currency: z.string(),
    notes: z.string().optional().nullable(),
});

// ========================= 【核心修改 - 開始】 =========================
const stagedChangeSchema = z.object({
    op: z.enum(['CREATE', 'UPDATE', 'DELETE']),
    // 擴充 entity 枚舉，使其能處理所有類型的 CUD 操作
    entity: z.enum([
        'transaction', 
        'split', 
        'dividend',
        'group',
        'group_membership', // 用於處理單一交易與群組的關係變更
        'note',
        'benchmark'
    ]),
    payload: z.any() // 具體驗證將在 handler 中根據 op 和 entity 進行
});
// ========================= 【核心修改 - 結束】 =========================


module.exports = {
    transactionSchema,
    splitSchema,
    userDividendSchema,
    stagedChangeSchema,
};
