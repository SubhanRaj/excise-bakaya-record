// worker.js
var worker_default = {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    try {
      if (request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM excise_dues ORDER BY district_name ASC").all();
        return Response.json(results, { headers: corsHeaders });
      }
      if (request.method === "POST") {
        const body = await request.json();
        const stmt = env.DB.prepare(`
          UPDATE excise_dues 
          SET collected_after_pac = ?, batte_khatte = ?, hc_stayed = ?, last_updated = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(body.collected_after_pac, body.batte_khatte, body.hc_stayed, body.id);
        await stmt.run();
        return Response.json({ success: true, message: "Record updated" }, { headers: corsHeaders });
      }
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
