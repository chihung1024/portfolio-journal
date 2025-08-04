// =========================================================================================
// == Cloudflare D1 Proxy Worker 完整程式碼 (v1.2 - 最終穩健版)
// =========================================================================================

export default {
  async fetch(request, env, ctx) {
    // [最終修正] 只宣告一次 pathname，並加入日誌
    console.log(`[DEBUG] Incoming request URL: ${request.url}`);
    const { pathname } = new URL(request.url);
    console.log(`[DEBUG] Parsed pathname: ${pathname}`);

    // 只接受 POST 請求
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // 驗證 API Key
    const apiKey = request.headers.get('X-API-KEY');
    if (apiKey !== env.D1_API_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      // [最終修正] 使用 .endsWith() 進行路由判斷，使其對 /query 和 //query 都有彈性
      if (pathname.endsWith('/query')) {
        const { sql, params = [] } = await request.json();
        if (!sql) {
          return new Response(JSON.stringify({ success: false, error: 'SQL query is missing' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const stmt = env.DB.prepare(sql).bind(...params);
        const { results } = await stmt.all();
        
        return new Response(JSON.stringify({ success: true, results: results }), { headers: { 'Content-Type': 'application/json' } });

      } else if (pathname.endsWith('/batch')) {
        const { statements } = await request.json();
        if (!statements || !Array.isArray(statements)) {
            return new Response(JSON.stringify({ success: false, error: 'Statements array is missing or invalid' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const preparedStatements = statements.map(stmt => env.DB.prepare(stmt.sql).bind(...(stmt.params || [])));
        const results = await env.DB.batch(preparedStatements);
        
        return new Response(JSON.stringify({ success: true, results: results }), { headers: { 'Content-Type': 'application/json' } });
      }

      // 如果路徑不匹配 /query 或 /batch，則回傳 404
      return new Response('Not Found', { status: 404 });

    } catch (e) {
      console.error('D1 Worker Error:', e);
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  },
};
