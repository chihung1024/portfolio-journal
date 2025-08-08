const axios = require("axios");

const D1_WORKER_URL = process.env.D1_WORKER_URL;
const D1_API_KEY = process.env.D1_API_KEY;

const d1Client = {
    async query(sql, params = []) {
        if (!D1_WORKER_URL || !D1_API_KEY) {
            throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set.");
        }
        try {
            const response = await axios.post(`${D1_WORKER_URL}/query`, { sql, params }, {
                headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' }
            });
            if (response.data && response.data.success) {
                return response.data.results;
            }
            throw new Error(response.data.error || "D1 查詢失敗");
        } catch (error) {
            console.error("d1Client.query Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 query: ${error.message}`);
        }
    },
    async batch(statements) {
        if (!D1_WORKER_URL || !D1_API_KEY) {
            throw new Error("D1_WORKER_URL and D1_API_KEY environment variables are not set.");
        }
        try {
            const response = await axios.post(`${D1_WORKER_URL}/batch`, { statements }, {
                headers: { 'X-API-KEY': D1_API_KEY, 'Content-Type': 'application/json' }
            });
            if (response.data && response.data.success) {
                return response.data.results;
            }
            throw new Error(response.data.error || "D1 批次操作失敗");
        } catch (error) {
            console.error("d1Client.batch Error:", error.response ? error.response.data : error.message);
            throw new Error(`Failed to execute D1 batch: ${error.message}`);
        }
    }
};

module.exports = { d1Client };
