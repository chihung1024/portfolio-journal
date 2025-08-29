// =========================================================================================
// == 投資組合狀態計算模組 (state.calculator.js) - FINAL VERSION
// =========================================================================================

const { toDate, findFxRate, getTotalCost, findNearest, isTwStock } = require('./helpers');

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

function getPortfolioStateOnDate(allEvts, targetDate, market) {
    const state = {};
    const pastEvents = allEvts.filter(e => toDate(e.date) <= toDate(targetDate));

    for (const e of pastEvents) {
        const sym = e.symbol.toUpperCase();
        if (!state[sym]) {
            state[sym] = { lots: [], currency: e.currency || "USD" };
        }
        state[sym].currency = e.currency;

        if (e.eventType === 'transaction') {
            const fx = findFxRate(market, e.currency, toDate(e.date));
            const costTWD = getTotalCost(e) * (e.currency === "TWD" ? 1 : fx);

            if (e.type === 'buy') {
                let buyQty = e.quantity;
                // 優先用買入來補回空頭倉位
                state[sym].lots.sort((a, b) => a.date - b.date); // 確保按時間順序補回
                while (buyQty > 0 && state[sym].lots.length > 0 && state[sym].lots[0].quantity < 0) {
                    const shortLot = state[sym].lots[0];
                    const qtyToCover = Math.min(buyQty, -shortLot.quantity);
                    
                    shortLot.quantity += qtyToCover;
                    buyQty -= qtyToCover;

                    if (Math.abs(shortLot.quantity) < 1e-9) {
                        state[sym].lots.shift();
                    }
                }
                // 如果還有剩餘的買入數量，則建立新的多頭倉位
                if (buyQty > 1e-9) {
                    state[sym].lots.push({
                        quantity: buyQty,
                        pricePerShareTWD: costTWD / (e.quantity || 1), // 成本以原始交易計算
                        pricePerShareOriginal: e.price,
                        date: toDate(e.date)
                    });
                }
            } else { // sell
                let sellQty = e.quantity;
                // 優先賣出現有的多頭倉位
                state[sym].lots.sort((a, b) => a.date - b.date); // 確保按 FIFO 賣出
                while (sellQty > 0 && state[sym].lots.length > 0 && state[sym].lots[0].quantity > 0) {
                    const longLot = state[sym].lots[0];
                    const qtyToSell = Math.min(sellQty, longLot.quantity);
                    
                    longLot.quantity -= qtyToSell;
                    sellQty -= qtyToSell;

                    if (longLot.quantity < 1e-9) {
                        state[sym].lots.shift();
                    }
                }
                // 如果還有剩餘的賣出數量，則建立新的空頭倉位
                if (sellQty > 1e-9) {
                    state[sym].lots.push({
                        quantity: -sellQty, // 數量為負
                        pricePerShareTWD: costTWD / (e.quantity || 1), // 這裡記錄的是賣出收入
                        pricePerShareOriginal: e.price,
                        date: toDate(e.date)
                    });
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
 * 根據當日持股狀態，計算其市場總價值 (TWD) - 最終修正版
 */
function dailyValue(state, market, date, allEvts) {
    let totalPortfolioValue = 0;

    for (const sym of Object.keys(state)) {
        const s = state[sym];
        const qty = s.lots.reduce((sum, lot) => sum + lot.quantity, 0);

        if (Math.abs(qty) < 1e-9) continue;

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
        
        const fx = findFxRate(market, s.currency, date);

        totalPortfolioValue += (qty * unadjustedPrice * (s.currency === "TWD" ? 1 : fx));
    }

    return totalPortfolioValue;
}

module.exports = {
    prepareEvents,
    getPortfolioStateOnDate,
    dailyValue,
};
