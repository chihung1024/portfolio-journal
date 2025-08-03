// =========================================================================================
// == Cloudflare D1 Proxy Worker 完整程式碼
// == 功能：
// == 1. 接收來自 GCP Cloud Function 的 API 請求。
// == 2. 驗證 API Key 的安全性。
// == 3. 執行 D1 資料庫的 SQL 查詢或批次寫入。
// == 4. 回傳結果給 GCP Cloud Function。
// =========================================================================================

export default {
  async fetch(request, env, ctx) {
    // 只接受 POST 請求
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 驗證 API Key
    const apiKey = request.headers.get('X-API-KEY');
    if (apiKey !== env.D1_API_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { pathname } = new URL(request.url);

    try {
      // 路由：根據路徑執行不同操作
      if (pathname === '/query') {
        const { sql, params = [] } = await request.json();
        if (!sql) {
          return new Response(JSON.stringify({ success: false, error: 'SQL query is missing' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const stmt = env.DB.prepare(sql).bind(...params);
        const { results } = await stmt.all();
        
        return new Response(JSON.stringify({ success: true, results: results }), { headers: { 'Content-Type': 'application/json' } });

      } else if (pathname === '/batch') {
        const { statements } = await request.json();
        if (!statements || !Array.isArray(statements)) {
            return new Response(JSON.stringify({ success: false, error: 'Statements array is missing or invalid' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const preparedStatements = statements.map(stmt => env.DB.prepare(stmt.sql).bind(...(stmt.params || [])));
        const results = await env.DB.batch(preparedStatements);
        
        return new Response(JSON.stringify({ success: true, results: results }), { headers: { 'Content-Type': 'application/json' } });
      }

      return new Response('Not Found', { status: 404 });

    } catch (e) {
      console.error('D1 Worker Error:', e);
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
};
