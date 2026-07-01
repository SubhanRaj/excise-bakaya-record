export default {
  async fetch(request, env) {
    // Standard CORS headers for frontend communication
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      // -----------------------------------------------------------
      // GET ROUTE: Fetch all district dues for the dropdown UI
      // -----------------------------------------------------------
      if (request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM excise_dues ORDER BY district_name ASC",
        ).all();
        return Response.json(results, { headers: corsHeaders });
      }

      // -----------------------------------------------------------
      // POST ROUTE: Handle Database Uploads (.csv or .sql)
      // -----------------------------------------------------------
      if (request.method === "POST" && url.pathname === "/upload") {
        try {
          const formData = await request.formData();
          const file = formData.get("uploadFile");

          if (!file) {
            return Response.json(
              { error: "No file detected in the request." },
              { status: 400, headers: corsHeaders },
            );
          }

          const fileName = file.name;
          const fileText = await file.text(); // Reads the file contents as a string

          /* 
          ===============================================================
          TODO: DATA PROCESSING LOGIC GOES HERE 
          Since D1 does not natively support executing a massive block 
          of raw SQL text in one single run() command via the API, 
          you would parse the CSV or split the SQL string here and 
          loop through env.DB.prepare(...).bind(...) for each row.
          ===============================================================
          */

          return Response.json(
            {
              success: true,
              message: `Successfully received ${fileName} (${fileText.length} bytes)! File processed.`,
            },
            { headers: corsHeaders },
          );
        } catch (uploadError) {
          return Response.json(
            { error: "Failed to parse upload: " + uploadError.message },
            { status: 500, headers: corsHeaders },
          );
        }
      }

      // -----------------------------------------------------------
      // POST ROUTE: Update existing district records from the UI
      // -----------------------------------------------------------
      if (request.method === "POST") {
        const body = await request.json();

        const stmt = env.DB.prepare(
          `
          UPDATE excise_dues 
          SET collected_after_pac = ?, batte_khatte = ?, hc_stayed = ?, last_updated = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        ).bind(
          body.collected_after_pac,
          body.batte_khatte,
          body.hc_stayed,
          body.id,
        );

        await stmt.run();

        return Response.json(
          { success: true, message: "Record updated" },
          { headers: corsHeaders },
        );
      }

      // Catch-all for unsupported methods/routes
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    } catch (e) {
      // Global error handler
      return Response.json(
        { error: e.message },
        { status: 500, headers: corsHeaders },
      );
    }
  },
};
