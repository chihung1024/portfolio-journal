// js/api.js

import state from './state.js';
import { showNotification } from './ui/notifications.js';

const API_BASE_URL = '/api';

async function fetchWithAuth(url, options = {}) {
    const token = state.isLoggedIn ? await state.authProvider.getToken() : null;
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    try {
        const response = await fetch(url, { ...options, headers });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(errorData.message || 'An unknown error occurred');
        }
        return response.json();
    } catch (error) {
        console.error(`API call to ${url} failed:`, error);
        showNotification(`Error: ${error.message}`, 'error');
        throw error;
    }
}

// Holdings and Portfolio
export const getHoldings = async () => {
    state.isLoading.holdings = true;
    try {
        const data = await fetchWithAuth(`${API_BASE_URL}/portfolio`);
        state.holdings = data.holdings;
        state.portfolioSummary = data.summary;
        state.chartData.labels = data.chartData.labels;
        state.chartData.totalValues = data.chartData.totalValues;
        state.chartData.totalCosts = data.chartData.totalCosts;
        state.chartData.marketValues = data.chartData.marketValues;
        state.chartData.netProfits = data.chartData.netProfits;
        state.chartData.twr = data.chartData.twr;
        state.chartData.assetDistribution = data.assetDistribution;
    } finally {
        state.isLoading.holdings = false;
    }
};

// Transactions
export const getTransactions = async () => {
    state.isLoading.transactions = true;
    try {
        const data = await fetchWithAuth(`${API_BASE_URL}/transactions`);
        state.transactions = data;
    } finally {
        state.isLoading.transactions = false;
    }
};

export const addTransaction = (transaction) => fetchWithAuth(`${API_BASE_URL}/transactions`, { method: 'POST', body: JSON.stringify(transaction) });
export const updateTransaction = (id, transaction) => fetchWithAuth(`${API_BASE_URL}/transactions/${id}`, { method: 'PUT', body: JSON.stringify(transaction) });
export const deleteTransaction = (id) => fetchWithAuth(`${API_BASE_URL}/transactions/${id}`, { method: 'DELETE' });

// Stock Details
export const getStockDetails = (symbol) => fetchWithAuth(`${API_BASE_URL}/details/${symbol}`);

// Closed Positions
export const getClosedPositions = async () => {
    state.isLoading.closedPositions = true;
    try {
        const data = await fetchWithAuth(`${API_BASE_URL}/closed-positions`);
        state.closedPositions = data;
    } finally {
        state.isLoading.closedPositions = false;
    }
};

// Dividends
export const getDividends = async () => {
    const data = await fetchWithAuth(`${API_BASE_URL}/dividends`);
    state.dividends = data;
};
export const addDividend = (dividend) => fetchWithAuth(`${API_BASE_URL}/dividends`, { method: 'POST', body: JSON.stringify(dividend) });
export const updateDividend = (id, dividend) => fetchWithAuth(`${API_BASE_URL}/dividends/${id}`, { method: 'PUT', body: JSON.stringify(dividend) });
export const deleteDividend = (id) => fetchWithAuth(`${API_BASE_URL}/dividends/${id}`, { method: 'DELETE' });

// Splits
export const getSplits = async () => {
    const data = await fetchWithAuth(`${API_BASE_URL}/splits`);
    state.splits = data;
}
export const addSplit = (split) => fetchWithAuth(`${API_BASE_URL}/splits`, { method: 'POST', body: JSON.stringify(split) });
export const updateSplit = (id, split) => fetchWithAuth(`${API_BASE_URL}/splits/${id}`, { method: 'PUT', body: JSON.stringify(split) });
export const deleteSplit = (id) => fetchWithAuth(`${API_BASE_URL}/splits/${id}`, { method: 'DELETE' });

// Groups
export const getGroups = async () => {
    const data = await fetchWithAuth(`${API_BASE_URL}/groups`);
    state.groups = data;
};
export const addGroup = (group) => fetchWithAuth(`${API_base_URL}/groups`, { method: 'POST', body: JSON.stringify(group) });
export const updateGroup = (id, group) => fetchWithAuth(`${API_BASE_URL}/groups/${id}`, { method: 'PUT', body: JSON.stringify(group) });
export const deleteGroup = (id) => fetchWithAuth(`${API_BASE_URL}/groups/${id}`, { method: 'DELETE' });
export const getGroupDetails = (id) => fetchWithAuth(`${API_BASE_URL}/groups/${id}`);

// Staging
export const getStagedActions = () => fetchWithAuth(`${API_BASE_URL}/staging`);
export const commitStagedActions = (payload) => fetchWithAuth(`${API_BASE_URL}/staging/commit`, { method: 'POST', body: JSON.stringify(payload) });
export const discardStagedActions = (ids) => fetchWithAuth(`${API_BASE_URL}/staging/discard`, { method: 'POST', body: JSON.stringify({ ids }) });


export const api = {
    getHoldings,
    getTransactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    getStockDetails,
    getClosedPositions,
    getDividends,
    addDividend,
    updateDividend,
    deleteDividend,
    getSplits,
    addSplit,
    updateSplit,
    deleteSplit,
    getGroups,
    addGroup,
    updateGroup,
    deleteGroup,
    getGroupDetails,
    getStagedActions,
    commitStagedActions,
    discardStagedActions,
};
