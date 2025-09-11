/**
 * 計算給定日期前的總交易成本
 * @param {Array<object>} transactions - 交易紀錄陣列
 * @param {Date} date - 計算截止日期
 * @returns {number} 總成本
 */
const calculateTotalCostBeforeDate = (transactions, date) => {
    return transactions
        .filter((t) => new Date(t.date) < date)
        .reduce((total, t) => {
            if (t.type === 'buy') {
                return total + t.shares * t.price;
            }
            return total;
        }, 0);
};

/**
 * 在給定日期計算特定股票的狀態（股數、平均成本等）
 *
 * @param {Date} date - 要計算狀態的日期
 * @param {Array<object>} transactions - 該股票的所有交易紀錄
 * @param {Array<object>} stockSplits - 該股票的所有股票分割紀錄
 * @returns {object} 包含股數、總成本、平均成本等的狀態物件
 */
const calculateStateAtDate = (date, transactions, stockSplits) => {
    // 根據股票分割調整交易紀錄
    const adjustedTransactions = transactions.map((t) => {
        const transactionDate = new Date(t.date);
        let shares = t.shares;
        let price = t.price;

        stockSplits.forEach((split) => {
            const splitDate = new Date(split.date);
            if (transactionDate < splitDate) {
                shares *= split.ratio;
                price /= split.ratio;
            }
        });

        return { ...t, shares, price };
    });

    //【根本原因修正】
    // 原邏輯為 new Date(t.date) < date，此為「差一日錯誤」(Off-by-one Error)，會遺漏計算截止日當天發生的交易。
    // 這會導致在計算除息日 (Ex-Dividend Date) 當天的持股數時，若當天有買入交易，系統會錯誤地判斷持股為零。
    // 現更正為 <= (小於或等於)，確保能正確包含邊界日期的交易，使歷史狀態的計算符合財經慣例。
    const relevantTransactions = adjustedTransactions.filter((t) => new Date(t.date) <= date);

    let totalShares = 0;
    let totalCost = 0;

    relevantTransactions.forEach((t) => {
        if (t.type === 'buy') {
            totalShares += t.shares;
            totalCost += t.shares * t.price;
        } else if (t.type === 'sell') {
            const averageCost = totalShares > 0 ? totalCost / totalShares : 0;
            const costOfSoldShares = t.shares * averageCost;
            totalCost -= costOfSoldShares;
            totalShares -= t.shares;
        }
    });

    // 避免除以零的錯誤
    const averageCost = totalShares > 0 ? totalCost / totalShares : 0;

    return {
        shares: totalShares,
        totalCost: totalCost,
        averageCost: averageCost,
    };
};

/**
 * 根據給定日期和價格計算市值
 * @param {number} shares - 股數
 * @param {number} price - 價格
 * @returns {number} 市值
 */
const calculateMarketValue = (shares, price) => {
    return shares * price;
};

/**
 * 計算總收益
 * @param {number} marketValue - 市值
 * @param {number} totalCost - 總成本
 * @returns {number} 總收益
 */
const calculateTotalGain = (marketValue, totalCost) => {
    return marketValue - totalCost;
};

/**
 * 計算總收益率
 * @param {number} totalGain - 總收益
 * @param {number} totalCost - 總成本
 * @returns {number} 總收益率
 */
const calculateTotalGainPercentage = (totalGain, totalCost) => {
    if (totalCost === 0) {
        return 0;
    }
    return (totalGain / totalCost) * 100;
};

export {
    calculateTotalCostBeforeDate,
    calculateStateAtDate,
    calculateMarketValue,
    calculateTotalGain,
    calculateTotalGainPercentage,
};
