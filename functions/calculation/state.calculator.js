// =========================================================================================
// == 投資組合狀態計算模組 (state.calculator.js) - v9.0 (Centralized Accounting Engine)
// == 職責：作為系統唯一的真實來源(Single Source of Truth)，計算任何時間點的投資組合狀態。
// =========================================================================================

const { toDate, findFxRate, getTotalCost, findNearest, isTwStock } = require('./helpers');

/**
 * 【中央會計引擎】根據所有事件，計算出截至某一天的投資組合最終狀態。
 * @param {Array} allEvts - 所有的事件 (交易、配息、拆股)
 * @param {object} market - 市場數據
 * @param {Date} [targetDate=null] - (可選) 計算的目標日期。若為 null，則計算至最新。
 * @returns {object} - 包含持股狀態 (pf) 和總已實現損益 (totalRealizedPL) 的物件
 */
function calculatePortfolioState(allEvts, market, targetDate = null) {
    const pf = {};
    let totalRealizedPL = 0;

    // 如果有指定目標日期，則只考慮該日期之前 (包含當天) 的事件
    const relevantEvents = targetDate
        ? allEvts.filter(e => toDate(e.date) <= toDate(targetDate))
        : allEvts;

    for (const e of relevantEvents) {
        const sym = e.symbol.toUpperCase();
        if (!pf[sym]) {
            pf[sym] = { lots: [], currency: e.currency || "USD", realizedPLTWD: 0 };
        }
        pf[sym].currency = e.currency;

        switch (e.eventType) {
            case "transaction": {
                const fx = (e.exchangeRate && e.currency !== 'TWD') ? e.exchangeRate : findFxRate(market, e.currency, toDate(e.date));
                
                if (e.type === "buy") {
                    const buyCostOriginal = getTotalCost(e);
                    let buyQty = e.quantity;
                    
                    pf[sym].lots.sort((a,b) => a.date - b.date);
                    while (buyQty > 0 && pf[sym].lots.length > 0 && pf[sym].lots[0].quantity < 0) {
                        const shortLot = pf[sym].lots[0];
                        const qtyToCover = Math.min(buyQty, -shortLot.quantity);
                        
                        const proceedsFromShortTWD = qtyToCover * shortLot.pricePerShareOriginal * shortLot.fxRateBuy;
                        const costToCoverTWD = (buyCostOriginal / e.quantity) * qtyToCover * fx;
                        const realizedPL = proceedsFromShortTWD - costToCoverTWD;
                        
                        totalRealizedPL += realizedPL;
                        pf[sym].realizedPLTWD += realizedPL;
                        
                        shortLot.quantity += qtyToCover;
                        buyQty -= qtyToCover;

                        if (Math.abs(shortLot.quantity) < 1e-9) {
                            pf[sym].lots.shift();
                        }
                    }
                    
                    if (buyQty > 1e-9) {
                        pf[sym].lots.push({ 
                            quantity: buyQty, 
                            pricePerShareOriginal: buyCostOriginal / e.quantity, 
                            fxRateBuy: fx,
                            date: toDate(e.date) 
                        });
                    }
                } else { // sell
                    let sellQty = e.quantity;
                    const proceedsPerShareOriginal = getTotalCost(e) / e.quantity;

                    pf[sym].lots.sort((a,b) => a.date - b.date);
                    while (sellQty > 0 && pf[sym].lots.length > 0 && pf[sym].lots[0].quantity > 0) {
                        const longLot = pf[sym].lots[0];
                        const qtyToSell = Math.min(sellQty, longLot.quantity);

                        const costOfGoodsSold = qtyToSell * longLot.pricePerShareOriginal * longLot.fxRateBuy;
                        const proceedsFromSale = qtyToSell * proceedsPerShareOriginal * fx;
                        const realizedPL = proceedsFromSale - costOfGoodsSold;

                        totalRealizedPL += realizedPL;
                        pf[sym].realizedPLTWD += realizedPL;

                        longLot.quantity -= qtyToSell;
                        sellQty -= qtyToSell;

                        if (longLot.quantity < 1e-9) {
                            pf[sym].lots.shift();
                        }
                    }

                    if (sellQty > 1e-9) {
                        pf[sym].lots.push({
                            quantity: -sellQty,
                            pricePerShareOriginal: proceedsPerShareOriginal,
                            fxRateBuy: fx,
                            date: toDate(e.date)
                        });
                    }
                }
                break;
            }
            case "split": {
                pf[sym].lots.forEach(l => {
                    l.quantity *= e.ratio;
                    l.pricePerShareOriginal /= e.ratio;
                });
                break;
            }
            case "confirmed_dividend":
            case "implicit_dividend": {
                let divTWD = 0;
                if (e.eventType === 'confirmed_dividend') {
                    const fx = findFxRate(market, e.currency, toDate(e.date));
                    divTWD = e.amount * (e.currency === "TWD" ? 1 : fx);
                } else { // implicit_dividend
                    const stateOnExDate = calculatePortfolioState(allEvts, market, toDate(e.ex_date)).pf;
                    const shares = stateOnExDate[sym]?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0;
                    if (shares > 0) {
                        const currency = stateOnExDate[sym]?.currency || 'USD';
                        const fx = findFxRate(market, currency, toDate(e.date));
                        const postTaxAmount = e.amount_per_share * (1 - (isTwStock(sym) ? 0.0 : 0.30));
                        divTWD = postTaxAmount * shares * (currency === "TWD" ? 1 : fx);
                    }
                }

                if (divTWD !== 0) {
                    const currentQty = pf[sym].lots.reduce((s, l) => s + l.quantity, 0);
                    const plEffect = currentQty >= 0 ? divTWD : -divTWD;
                    totalRealizedPL += plEffect;
                    pf[sym].realizedPLTWD += plEffect;
                }
                break;
            }
        }
    }

    return { pf, totalRealizedPL };
}

/**
 * 根據給定的持股狀態，計算其在特定日期的市場總價值 (TWD)
 * @param {object} state - 從 calculatePortfolioState 獲取的 pf 物件
 * @param {object} market - 市場數據
 * @param {Date} date - 目標日期
 * @param {Array} allEvts - 所有事件(用於查找未來拆股)
 * @returns {number} - 市場總價值 (TWD)
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
            e.symbol.toUpperCase() === sym && 
            toDate(e.date) > toDate(priceDate)
        );
        const adjustmentRatio = futureSplits.reduce((acc, split) => acc * split.ratio, 1);
        const unadjustedPrice = price * adjustmentRatio;
        
        const fx = findFxRate(market, s.currency, date);
        totalPortfolioValue += (qty * unadjustedPrice * (s.currency === "TWD" ? 1 : fx));
    }

    return totalPortfolioValue;
}

// 導出新的、唯一的狀態計算機和相關函式
module.exports = {
    calculatePortfolioState,
    dailyValue,
    // 舊的 getPortfolioStateOnDate 已被徹底移除
};
