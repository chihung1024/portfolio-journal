// =========================================================================================
// == API 通訊模組 (api.js)
// =========================================================================================
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { API }      from './config.js';
import { getState, setState } from './state.js';
import {
  renderHoldingsTable, renderTransactionsTable, renderSplitsTable,
  renderDividendsTable, updateDashboard, updateAssetChart, updateTwrChart,
  showNotification
} from './ui.js';

/* 統一呼叫後端（自帶 Firebase Token）*/
export async function apiRequest(action, data) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    showNotification('error', '請先登入再執行操作。');
    throw new Error('User not logged in');
  }

  const token = await user.getIdToken();
  const payload = { action, data };
  const res = await fetch(API.URL, {
    method : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-API-KEY'   : API.KEY
    },
    body: JSON.stringify(payload)
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.message || '伺服器發生錯誤');
  return result;
}

/* 一次載入所有投資組合資料（含手動股息）並刷新畫面 */
export async function loadPortfolioData() {
  const { currentUserId } = getState();
  if (!currentUserId) return;

  document.getElementById('loading-overlay').style.display = 'flex';
  try {
    // 並行抓主要資料與股息
    const [main, divs] = await Promise.all([
      apiRequest('get_data', {}),
      apiRequest('get_dividend_events', {})
    ]);

    const portfolioData = main.data;
    const manualDividends = divs.data || [];

    const stockNotesMap = (portfolioData.stockNotes || []).reduce((m, n) => {
      m[n.symbol] = n; return m;
    }, {});

    /* 更新全域狀態 */
    setState({
      transactions     : portfolioData.transactions || [],
      userSplits       : portfolioData.splits       || [],
      manualDividends,                               // ← 關鍵
      marketDataForFrontend: portfolioData.marketData || {},
      stockNotes: stockNotesMap
    });

    /* 重新渲染所有 UI */
    const holdingsObj = (portfolioData.holdings || []).reduce((o, h) => {
      o[h.symbol] = h; return o;
    }, {});
    renderHoldingsTable(holdingsObj);
    renderTransactionsTable();
    renderDividendsTable();      // ← 新增
    renderSplitsTable();
    updateDashboard(
      holdingsObj,
      portfolioData.summary?.totalRealizedPL,
      portfolioData.summary?.overallReturnRate,
      portfolioData.summary?.xirr
    );
    updateAssetChart(portfolioData.history || {});
    const benchmark = portfolioData.summary?.benchmarkSymbol || 'SPY';
    updateTwrChart(
      portfolioData.twrHistory    || {},
      portfolioData.benchmarkHistory || {},
      benchmark
    );
    document.getElementById('benchmark-symbol-input').value = benchmark;
    showNotification('success', '資料同步完成！');
  } catch (err) {
    console.error(err);
    showNotification('error', `讀取資料失敗: ${err.message}`);
  } finally {
    document.getElementById('loading-overlay').style.display = 'none';
  }
}
