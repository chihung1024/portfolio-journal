// js/ui/utils.js

import state from '../state.js';

export function formatCurrency(value, withSign = false) {
    if (value === null || value === undefined) {
        return 'N/A';
    }
    const num = Number(value);
    const sign = withSign ? (num > 0 ? '+' : '') : '';
    return `${sign}${num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export function formatPercentage(value) {
    if (value === null || value === undefined) {
        return 'N/A';
    }
    const num = Number(value) * 100;
    return `${num.toFixed(2)}%`;
}

export function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}
