// =========================================================================================
// == 投資組合狀態計算模組 (state.calculator.js)
// == 職責：根據事件歷史，計算在任何指定日期的投資組合狀態 (持股、成本) 及其市場價值。
// =========================================================================================

const { toDate, findFxRate, getTotalCost, findNearest, isTwStock } = require('./helpers');

/**
 * 準備一個統一的、按時間排序的事件列表，供後續計算使用
 * @param {Array} txs - 使用者交易紀錄
 * @param {Array} splits - 使用者拆股紀錄
 * @param {object} market - 市場數據
 * @param {Array} userDividends - 使用者已確認的股利
 * @returns {{evts: Array, firstBuyDate: Date|null}} 包含所有事件的列表和首次購買日期
 */
function prepareEvents(txs, splits, market, userDividends) {
    const firstBuyDateMap = {};
    txs.forEach(tx => {
        if (tx.type === "buy") {
            const sym = tx.symbol.toUpperCase();
            const d = toDate(tx.date);
            if (!firstBuyDateMap[sym] || d < firstBuyDateMap[sym]) {
                firstBuyDateMap[sym] = d;
            }
        }
    });

    const evts = [
        ...txs.map(t => ({ ...t, eventType: "transaction" })),
        ...splits.map(s => ({ ...s, eventType: "split" }))
    ];

    const confirmedDividendKeys = new Set(userDividends.map(d => `${d.symbol.toUpperCase()}_${d.ex_dividend_date.split('T')[0]}`));
    
    userDividends.forEach(ud => {
        evts.push({
            eventType: 'confirmed_dividend',
            date: toDate(ud.pay_date),
            symbol: ud.symbol.toUpperCase(),
            amount: ud.total_amount,
            currency: ud.currency
        });
    });

    Object.keys(market).forEach(sym => {
        if (market[sym]?.dividends) {
            Object.entries(market[sym].dividends).forEach(([dateStr, amount]) => {
                const dividendDate = toDate(dateStr);
                if (confirmedDividendKeys.has(`${sym.toUpperCase()}_${dateStr}`)) return;
                if (firstBuyDateMap[sym] && dividendDate >= firstBuyDateMap[sym] && amount > 0) {
                    const payDate = new Date(dividendDate);
                    payDate.setMonth(payDate.getMonth() + 1);
                    evts.push({
                        eventType: "implicit_dividend",
                        date: payDate,
                        ex_date: dividendDate,
                        symbol: sym.toUpperCase(),
                        amount_per_share: amount
                    });
                }
            });
        }
    });

    evts.sort((a, b) => toDate(a.date) - toDate(b.date));
    const firstTx = evts.find(e => e.eventType === 'transaction');
    return { evts, firstBuyDate: firstTx ? toDate(firstTx.date) : null };
}


/**
 * 獲取在某個特定日期結束時的投資組合狀態 (FIFO)
 * @param {Array} allEvts - 所有事件的列表
 * @param {Date} targetDate - 目標日期
 * @param {object} market - 市場數據
 * @returns {object} 當日的投資組合狀態，包含每個持股的 lots
 */
function getPortfolioStateOnDate(allEvts, targetDate, market) {
    const state = {};
    const pastEvents = allEvts.filter(e => toDate(e.date) <= toDate(targetDate));

    for (const e of pastEvents) {
        const sym = e.symbol.toUpperCase();
        if (!state[sym]) {
            state[sym] = { lots: [], currency: e.currency || "USD" };
        }

        if (e.eventType === 'transaction') {
            state[sym].currency = e.currency;
            if (e.type === 'buy') {
                const fx = findFxRate(market, e.currency, toDate(e.date));
                const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);
                state[sym].lots.push({
                    quantity: e.quantity,
                    pricePerShareTWD: costTWD / (e.quantity || 1),
                    pricePerShareOriginal: e.price,
                    date: toDate(e.date)
                });
            } else { // sell
                let sellQty = e.quantity;
                while (sellQty > 0 && state[sym].lots.length > 0) {
                    const lot = state[sym].lots[0];
                    if (lot.quantity <= sellQty) {
                        sellQty -= lot.quantity;
                        state[sym].lots.shift();
                    } else {
                        lot.quantity -= sellQty;
                        sellQty = 0;
                    }
                }
            }
        } else if (e.eventType === 'split') {
            state[sym].lots.forEach(lot => {
                lot.quantity *= e.ratio;
                lot.pricePerShareTWD /= e.ratio;
                lot.pricePerShareOriginal /= e.ratio;
            });
        }
    }
    return state;
}

/**
 * 根據當日持股狀態，計算其市場總價值 (TWD)
 * @param {object} state - 從 getPortfolioStateOnDate 來的持股狀態
 * @param {object} market - 市場數據
 * @param {Date} date - 目標日期
 * @param {Array} allEvts - 所有事件列表 (用於處理未來拆股的股價還原)
 * @returns {number} 當日市場總價值
 */
/**
 * 根據當日持股狀態，計算其市場總價值 (TWD) - 最終修正版
 */
function dailyValue(state, market, date, allEvts) {
    let totalPortfolioValue = 0;

    for (const sym of Object.keys(state)) {
        const s = state[sym];
        const qty = s.lots.reduce((sum, lot) => sum + lot.quantity, 0);

        if (qty < 1e-9) continue;

        const priceInfo = findNearest(market[sym]?.prices, date);

        if (!priceInfo) continue;
        
        const { date: priceDate, value: price } = priceInfo;

        const futureSplits = allEvts.filter(e => 
            e.eventType === 'split' && 
            e.symbol.toUpperCase() === sym.toUpperCase() && 
            toDate(e.date) > toDate(priceDate)
        );
        const adjustmentRatio = futureSplits.reduce((acc, split) => acc * split.ratio, 1);
        const unadjustedPrice = price * adjustmentRatio;
        
        const fx = findFxRate(market, s.currency, priceDate);

        totalPortfolioValue += (qty * unadjustedPrice * (s.currency === "TWD" ? 1 : fx));
    }

    return totalPortfolioValue;
}

module.exports = {
    prepareEvents,
    getPortfolioStateOnDate,
    dailyValue,
};
