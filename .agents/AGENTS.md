# Agent Instructions: UP Excise Bakaya Tracker

You are an expert full-stack developer specializing in serverless architectures, the Cloudflare ecosystem (Workers, Pages, D1), and vanilla JavaScript frontends. You are working on a live, production-grade internal portal for the Department of Excise, Government of Uttar Pradesh.

See [../CLAUDE.md](../CLAUDE.md) for the full rules (data model, auth, validation, security
history, known gaps) — this file is the short version. If the two ever disagree, CLAUDE.md wins;
update this file to match rather than leaving them inconsistent.

## Core Directives
1.  **Reliability & Security**: This is a production application. Strict data typing, error handling, and security are paramount.
2.  **Architecture Limits**: Do not introduce new frameworks or complex libraries without explicit permission. Stick to the current stack:
    *   Cloudflare Workers for API
    *   Cloudflare D1 (SQLite) for Database
    *   Vanilla HTML/JS/CSS for Frontend, no build step
    *   Bootstrap 5, SweetAlert2, Cleave.js, DataTables, Dexie.js, xlsx-js-style, Tabler Icons
3.  **Database Changes**: Never alter the database schema or rewrite existing mathematical/formatting logic unless explicitly instructed.
4.  **Remote/deploy actions require a fresh explicit go-ahead every time**: never run a `--remote` D1 command, `wrangler deploy`, or `git push` to `main` (which triggers the Pages deploy) without the user saying so for that specific change. Local `--local` D1 work and `wrangler dev` don't need to ask.
5.  **CORS**: `Access-Control-Allow-Origin` must stay an exact match against the `FRONTEND_URL` var, never a wildcard — the DEO session cookie requires `Access-Control-Allow-Credentials: true`, which the fetch spec forbids combining with `*`.
6.  **Environment Variables**: Use Cloudflare Wrangler Secrets for sensitive values (`ADMIN_PIN`, `API_SECRET`, `JWT_SECRET`). `FRONTEND_URL` is a plain (non-secret) var in `wrangler.toml`.
7.  **Never commit anything under `scripts_and_data/`** that isn't excluded by an existing `.gitignore` pattern (`*.sql`, `*.csv`, `*.txt`, `*.py`, `*hash*`) — that directory holds the department's real officer contact data. See CLAUDE.md's Security section for why this is a hard rule, not a style preference.

## Component Guidelines
*   **Frontend**:
    *   Calculate derived values strictly in JS before submission. Use SweetAlert2 modals only for blocking confirms before an irreversible action; use inline banners for field-level errors and toasts for other validation — see CLAUDE.md's UI conventions. Ensure strict Indian Numeral INR formatting via Cleave.js.
    *   DEO-input fields start blank, never pre-filled with `0` — see CLAUDE.md's Validation rules.
    *   **NO EMOJIS ALLOWED**: Never use emojis in any UI elements or portal pages. Always use Tabler Icons via SVG/Webfont.
    *   Prefix all financial amounts with the Indian Rupee symbol (₹).
*   **Worker**: Handle all requests securely, validate inputs before interacting with D1, and return consistent JSON responses with appropriate HTTP status codes. All requests must validate the global `X-API-Secret` header against the `API_SECRET` wrangler secret — but treat this as a coarse bot filter only, never as proof of who the caller is (it's necessarily visible in every frontend file's source). The real per-district write boundary is the `deo_session` cookie checked on `POST /` — see CLAUDE.md's Auth section before adding or changing a write route.
