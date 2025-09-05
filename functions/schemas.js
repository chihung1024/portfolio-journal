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

module.exports = {
    transactionSchema,
    splitSchema,
    userDividendSchema,
};
