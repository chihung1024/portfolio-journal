// js/state.js

const state = {
    transactions: [],
    holdings: [],
    closedPositions: [],
    dividends: [],
    splits: [],
    groups: [],
    portfolioSummary: {},
    chartData: {
        labels: [],
        totalValues: [],
        totalCosts: [],
        marketValues: [],
        netProfits: [],
        twr: [],
        assetDistribution: {},
    },
    isLoading: {
        transactions: false,
        holdings: false,
        portfolio: false,
        closedPositions: false,
    },
    holdingsSort: {
        key: 'unrealizedProfit',
        order: 'desc'
    },
    closedPositionsSort: {
        key: 'exitDate',
        order: 'desc'
    },
    transactionFilter: {
        symbol: '',
        type: '',
        startDate: '',
        endDate: ''
    },
    isLoggedIn: false,
    authProvider: null,
};

export default state;
