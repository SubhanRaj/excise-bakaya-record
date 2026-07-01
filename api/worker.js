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

    // --- NEW: Admin Authentication Route ---
    if (request.method === "POST" && url.pathname === "/auth") {
      try {
        const { pin } = await request.json();

        // Hash the input using Web Crypto API
        const encoder = new TextEncoder();
        const data = encoder.encode(pin);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        // SHA-256 Hash for "2026" (Change this hash to match your desired PIN)
        const expectedHash =
          "7bc0b98eb6c34beeb1918a032ddb6e7fae446552bbfa79ff10be69752f9b69b3";

        if (hashHex === expectedHash) {
          return Response.json({ success: true }, { headers: corsHeaders });
        } else {
          return Response.json(
            { success: false },
            { status: 401, headers: corsHeaders },
          );
        }
      } catch (e) {
        return Response.json(
          { error: "Auth Failed" },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    // --- Unlock Route ---
    if (request.method === "POST" && url.pathname === "/unlock") {
      try {
        const data = await request.json();
        // Reset lock, DEO name, and time
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

        // Update records and lock the row, including the DEO name and current time
        const stmt = env.DB.prepare(
          `
          UPDATE excise_dues 
          SET collected_after_date = ?, batte_khatte_count = ?, batte_khatte_amount = ?, court_stayed_amount = ?, deo_name = ?, is_locked = 1, locked_at = CURRENT_TIMESTAMP, last_updated = CURRENT_TIMESTAMP
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

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (e) {
      return Response.json(
        { error: e.message },
        { status: 500, headers: corsHeaders },
      );
    }
  },
};
