export default {
  async fetch(request, env) {
    // 1. Setup CORS so your frontend can communicate with this API safely
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ---------------------------------------------------------
    // ROUTE: /auth (Admin Authentication via Wrangler Secrets)
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/auth") {
      try {
        const { pin } = await request.json();

        // Securely compare the provided PIN against the encrypted Cloudflare Secret
        if (pin === env.ADMIN_PIN) {
          return Response.json({ success: true }, { headers: corsHeaders });
        } else {
          return Response.json(
            { success: false },
            { status: 401, headers: corsHeaders },
          );
        }
      } catch (e) {
        return Response.json(
          { error: "Authentication Failed" },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    // ---------------------------------------------------------
    // ROUTE: /unlock (Admin unlocks a district for re-entry)
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/unlock") {
      try {
        const data = await request.json();

        // Reset the lock, clear the DEO name, and clear the locked timestamp
        await env.DB.prepare(
          `UPDATE excise_dues SET is_locked = 0, deo_name = NULL, locked_at = NULL WHERE id = ?`,
        )
          .bind(data.id)
          .run();

        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json(
          { error: "Database Error" },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    try {
      // ---------------------------------------------------------
      // ROUTE: GET / (Fetch all district data for forms and tables)
      // ---------------------------------------------------------
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

      // ---------------------------------------------------------
      // ROUTE: POST / (DEO submits data and locks their district)
      // ---------------------------------------------------------
      if (
        request.method === "POST" &&
        (url.pathname === "/" ||
          url.pathname === "/api/dues" ||
          url.pathname === "")
      ) {
        const body = await request.json();

        // Update the financial records, lock the row, and record the DEO's name & time
        const stmt = env.DB.prepare(
          `
          UPDATE excise_dues 
          SET 
            collected_after_date = ?, 
            batte_khatte_count = ?, 
            batte_khatte_amount = ?, 
            court_stayed_amount = ?, 
            deo_name = ?, 
            is_locked = 1, 
            locked_at = CURRENT_TIMESTAMP, 
            last_updated = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        ).bind(
          body.collected_after_date,
          body.batte_khatte_count,
          body.batte_khatte_amount,
          body.court_stayed_amount,
          body.deo_name,
          body.id,
        );

        await stmt.run();
        return Response.json(
          { success: true, message: "Record updated and locked." },
          { headers: corsHeaders },
        );
      }

      // If no routes match
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (e) {
      // Global error handler for database/execution failures
      return Response.json(
        { error: e.message },
        { status: 500, headers: corsHeaders },
      );
    }
  },
};
