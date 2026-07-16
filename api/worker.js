// In-memory store for rate limiting per edge-node instance
const rateLimitMap = new Map();

const DEO_SESSION_COOKIE = "deo_session";
const DEO_SESSION_TTL_SECONDS = 60 * 60 * 24; // 1 day — DEOs verify once per data-entry sitting
const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 4; // 4 hours — matches the old sessionStorage-dies-with-tab feel

// In-memory brute-force throttle for /auth specifically — a 4-digit PIN is only 10,000
// combinations, well within what the general 60 req/min limit below would allow an attacker to
// exhaust. Separate map/key from rateLimitMap so it doesn't get crowded out by normal traffic.
const authAttemptsMap = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const AUTH_MAX_ATTEMPTS = 10;

// Minimal HMAC-signed session token (base64url(payload) + "." + base64url(HMAC-SHA256)) — same
// idea as a JWT (signed, tamper-evident, expiring) without pulling in a JWT library for two call
// sites. Used for both the DEO session (bound to a district_id) and the Admin session (bound to
// a role) so a leaked/guessed X-API-Secret alone can no longer be used to write DEO data or hit
// an admin-only route.
function b64urlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeToBytes(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signToken(payload, secret) {
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64urlEncode(new Uint8Array(sig))}`;
}
async function verifyToken(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sigB64] = token.split(".");
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, b64urlDecodeToBytes(sigB64), new TextEncoder().encode(payloadB64));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(payloadB64)));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function signDeoToken(districtId, secret) {
  return signToken({ districtId, exp: Date.now() + DEO_SESSION_TTL_SECONDS * 1000 }, secret);
}
function signAdminToken(secret) {
  return signToken({ role: "admin", exp: Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000 }, secret);
}
async function isAdminSession(request, env) {
  const payload = await verifyToken(getCookie(request, ADMIN_SESSION_COOKIE), env.JWT_SECRET);
  return !!payload && payload.role === "admin";
}
function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

export default {
  async fetch(request, env) {
    // 1. CORS — frontend (Pages) and this API (Worker) are separate origins, and the DEO
    // session cookie requires credentials mode, which forbids the "*" wildcard. Only the
    // configured frontend origin gets Allow-Origin + Allow-Credentials.
    const origin = request.headers.get("Origin");
    const corsHeaders = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Secret",
    };
    if (origin && origin === env.FRONTEND_URL) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
      corsHeaders["Access-Control-Allow-Credentials"] = "true";
    }

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Basic In-Memory Rate Limiting (Protects DB from brute force/spam)
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const maxRequests = 60; // Max 60 requests per IP per minute per edge node

    // Prevent memory leaks under DDoS
    if (rateLimitMap.size > 5000) rateLimitMap.clear();

    let record = rateLimitMap.get(ip);
    if (!record) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    } else {
      if (now > record.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
      } else {
        record.count++;
        if (record.count > maxRequests) {
          return Response.json(
            { error: "Too Many Requests. Please try again later." },
            { status: 429, headers: corsHeaders }
          );
        }
      }
    }

    // Global API Key Authorization
    const apiSecret = request.headers.get("X-API-Secret");
    if (!apiSecret || apiSecret !== env.API_SECRET) {
      return Response.json(
        { error: "Unauthorized: Invalid API Secret" },
        { status: 401, headers: corsHeaders }
      );
    }

    const url = new URL(request.url);

    // ---------------------------------------------------------
    // ROUTE: /auth (Admin Authentication via Wrangler Secrets)
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/auth") {
      // Throttle PIN guesses specifically — a 4-digit PIN is only 10,000 combinations.
      const authNow = Date.now();
      let authRecord = authAttemptsMap.get(ip);
      if (!authRecord || authNow > authRecord.resetTime) {
        authRecord = { count: 0, resetTime: authNow + AUTH_WINDOW_MS };
      }
      authRecord.count++;
      authAttemptsMap.set(ip, authRecord);
      if (authRecord.count > AUTH_MAX_ATTEMPTS) {
        return Response.json(
          { error: "Too many attempts. Try again later." },
          { status: 429, headers: corsHeaders },
        );
      }

      try {
        const { pin } = await request.json();

        // Securely compare the provided PIN against the encrypted Cloudflare Secret
        if (pin === env.ADMIN_PIN) {
          const token = await signAdminToken(env.JWT_SECRET);
          const cookie = `${ADMIN_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}`;
          return Response.json({ success: true }, { headers: { ...corsHeaders, "Set-Cookie": cookie } });
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
    // ROUTE: /admin-logout (clears the httpOnly admin session cookie)
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/admin-logout") {
      const cookie = `${ADMIN_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0`;
      return Response.json({ success: true }, { headers: { ...corsHeaders, "Set-Cookie": cookie } });
    }

    // ---------------------------------------------------------
    // ROUTE: /unlock (Admin unlocks a district for re-entry)
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/unlock") {
      if (!(await isAdminSession(request, env))) {
        return Response.json({ error: "Unauthorized: admin session required" }, { status: 403, headers: corsHeaders });
      }
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

    // ---------------------------------------------------------
    // ROUTE: /truncate-demo (Admin one-time clear demo data)
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/truncate-demo") {
      if (!(await isAdminSession(request, env))) {
        return Response.json({ error: "Unauthorized: admin session required" }, { status: 403, headers: corsHeaders });
      }
      try {
        await env.DB.prepare(
          `DELETE FROM excise_dues WHERE district_name = 'Demo District'`
        ).run();

        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json(
          { error: "Database Error" },
          { status: 500, headers: corsHeaders },
        );
      }
    }

    // ---------------------------------------------------------
    // ROUTE: /verify-deo (CUG authentication)
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/verify-deo") {
      try {
        const { cug_hash } = await request.json();
        // Client hashes the CUG number before it ever leaves the browser (SHA-256, Web Crypto)
        if (!cug_hash || !/^[a-f0-9]{64}$/.test(cug_hash)) {
          return Response.json({ success: false, error: "Invalid CUG hash" }, { status: 400, headers: corsHeaders });
        }

        // Verify against database
        const result = await env.DB.prepare(
          "SELECT id, district_name FROM excise_dues WHERE cug_hash = ?"
        ).bind(cug_hash).first();

        if (result) {
          const token = await signDeoToken(result.id, env.JWT_SECRET);
          const cookie = `${DEO_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${DEO_SESSION_TTL_SECONDS}`;
          return Response.json(
            { success: true, district_id: result.id, district_name: result.district_name },
            { headers: { ...corsHeaders, "Set-Cookie": cookie } },
          );
        } else {
          return Response.json({ success: false, error: "Unauthorized" }, { status: 401, headers: corsHeaders });
        }
      } catch (err) {
        return Response.json({ error: "Verification Failed" }, { status: 500, headers: corsHeaders });
      }
    }

    // ---------------------------------------------------------
    // ROUTE: /deo-logout (clears the httpOnly session cookie)
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/deo-logout") {
      const cookie = `${DEO_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0`;
      return Response.json({ success: true }, { headers: { ...corsHeaders, "Set-Cookie": cookie } });
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

        // Require a verified DEO session bound to this exact district — without this, knowing
        // the (necessarily client-visible) X-API-Secret alone would let anyone lock/overwrite
        // any district by guessing its id.
        const session = await verifyToken(getCookie(request, DEO_SESSION_COOKIE), env.JWT_SECRET);
        if (!session || session.districtId !== body.id) {
          return Response.json(
            { error: "Unauthorized: no verified session for this district" },
            { status: 403, headers: corsHeaders },
          );
        }

        // Update the financial records, lock the row, and record the DEO's name & time
        const stmt = env.DB.prepare(
          `
          UPDATE excise_dues
          SET
            collected_after_date = ?,
            batte_khatte_count = ?,
            batte_khatte_amount = ?,
            court_case_count = ?,
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
          body.court_case_count,
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
