// =========================================================================================
// == Frontend Service: stagingService.js v1.0.0
// == 提供前端呼叫 staging Cloud Functions 的統一接口
// =========================================================================================

import axios from 'axios';

const API_BASE = '/staging'; // 可依部署情況調整，或使用 Firebase Functions URL

export const stagingService = {
  async stage(command) {
    const res = await axios.post(`${API_BASE}/stage`, { command });
    return res.data;
  },

  async list() {
    const res = await axios.get(`${API_BASE}/list`);
    return res.data;
  },

  async discard(ids) {
    const res = await axios.post(`${API_BASE}/discard`, { ids });
    return res.data;
  },

  async commit(batchSize = 100) {
    const res = await axios.post(`${API_BASE}/commit`, { batchSize });
    return res.data;
  },

  async snapshot() {
    const res = await axios.get(`${API_BASE}/snapshot`);
    return res.data;
  },
};
