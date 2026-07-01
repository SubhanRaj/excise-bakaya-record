export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);

    try {
      if (
        request.method === "GET" &&
        (url.pathname === "/" ||
          url.pathname === "/api/dues" ||
          url.pathname === "")
      ) {
        const { results } = await env.DB.prepare(
          "SELECT * FROM excise_dues ORDER BY district_name ASC",
        ).all();
        return Response.json(results, { headers: corsHeaders });
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/" ||
          url.pathname === "/api/dues" ||
          url.pathname === "")
      ) {
        const body = await request.json();

        // Update records and lock the row
        const stmt = env.DB.prepare(
          `
          UPDATE excise_dues 
          SET collected_after_date = ?, batte_khatte_count = ?, batte_khatte_amount = ?, court_stayed_amount = ?, is_locked = 1, last_updated = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        ).bind(
          body.collected_after_date,
          body.batte_khatte_count,
          body.batte_khatte_amount,
          body.court_stayed_amount,
          body.id,
        );

        await stmt.run();
        return Response.json(
          { success: true, message: "Record updated and locked." },
          { headers: corsHeaders },
        );
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (e) {
      return Response.json(
        { error: e.message },
        { status: 500, headers: corsHeaders },
      );
    }
  },
};
