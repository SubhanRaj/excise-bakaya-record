# UP Excise Bakaya Tracker

A production internal portal built for the Department of Excise, Government of Uttar Pradesh to
track and manage dues ("Bakaya") across 59 districts. District Excise Officers (DEOs) submit and
lock one round of recovery figures each; Admins review, export, and can unlock a district for
re-entry.

See [CLAUDE.md](./CLAUDE.md) for the rules an AI agent must follow when working in this repo, and
[v2plan.md](./v2plan.md) for the v2 change history (PAC re-baseline, court case count, DEO login
page, session auth).

## Tech Stack & Libraries

A monorepo, deliberately serverless with no build step.

### Frontend (`/frontend`) — Cloudflare Pages
Static HTML/CSS/JS, no bundler (Webpack/Vite). Three pages:
*   **`login.html`** — DEO-only CUG login. No admin option here (Admin PIN lives in `admin.html`).
*   **`index.html`** — DEO data-entry form. Redirects to `login.html` if no verified session exists.
*   **`admin.html`** — Admin dashboard (PIN-gated, separate from the DEO session).

Libraries:
*   **Bootstrap 5 (CDN)** — grid, cards, base styling.
*   **SweetAlert2** — reserved for blocking confirms before an irreversible action (locking a
    record, admin unlock, truncate-demo, logout) — see CLAUDE.md's UI conventions for the
    inline-vs-modal split.
*   **Cleave.js** — real-time Indian Numeral (Lakh/Crore) input formatting on money fields.
*   **DataTables + jQuery** — the Admin Dashboard's grid (search/sort/pagination/sticky headers).
*   **Dexie.js** — IndexedDB cache on the Admin Dashboard so all districts load instantly on
    revisit, with an explicit Sync button to bypass the cache.
*   **xlsx-js-style** (SheetJS fork with cell styling) — generates the Admin's `.xlsx` export
    with real cell colors, frozen panes, and currency formatting, client-side.
*   **Tabler Icons** (webfont) — all UI iconography. No emojis anywhere in the UI.

### Backend (`/api`) — Cloudflare Workers + D1
*   **Cloudflare Workers** (`worker.js`) — single-file router for all API traffic.
*   **Cloudflare D1** (`schema.sql`) — serverless SQLite.
*   **Web Crypto API** (`crypto.subtle`) — SHA-256 hashing of CUG mobile numbers (client-side,
    before the raw number ever leaves the browser) and HMAC-SHA256 signing of DEO session tokens
    (server-side) — no external crypto/JWT dependency.
*   **Wrangler** — local D1 execution, secret management, deploys.

### Data Processing Utilities (`scripts_and_data/`)
*   **Python 3** (`gen_deo_data.py`, kept locally, gitignored) — maps the department's Hindi
    contact directory to English district names, hashes CUG numbers, and emits the seed SQL that
    populates `cug_hash`/`deo_email` for the 59 tracked districts. Never commit this script's
    inputs or outputs — see Security below.

## Database Schema

`excise_dues` — one row per district (plus one `Demo District` row used only for pre-launch
testing, truncated via the Admin dashboard before real DEOs get the URL).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `district_name` | TEXT | Current official name — e.g. `Prayagraj` (not `Allahabad`), `Lakhimpur Kheri` (not `Kheri`). |
| `total_dues` | REAL | **"2. वसूल की जाने वाली सकल धनराशि"** — read-only, sourced from the department's Excel report. |
| `collected_till_date` | REAL | **"3. 08-Jul-26 तक वसूल की गई धनराशि"** — read-only, the PAC-meeting baseline. |
| `collected_after_date` | REAL | **"4. 08-Jul-26 के उपरांत वसूल की गई धनराशि"** — DEO input. |
| `batte_khatte_count` / `batte_khatte_amount` | INTEGER / REAL | **"6. ... बट्टे खाते ..."** — DEO input, count + amount. |
| `court_case_count` / `court_stayed_amount` | INTEGER / REAL | **"7. ... न्यायालय द्वारा स्थगित ..."** — DEO input, count + amount, mirrors Batte Khatte. |
| `is_locked` | INTEGER DEFAULT 0 | Flips to 1 when the DEO locks the record. |
| `deo_name` | TEXT | Captured via SweetAlert2 at lock time — the digital signature. |
| `deo_email` | TEXT | Reference-only provisioning data (department contact directory), not entered by the DEO. |
| `cug_hash` | TEXT, UNIQUE | SHA-256 of the DEO's 10-digit CUG mobile number. |
| `locked_at` | DATETIME | |
| `last_updated` | DATETIME | |

"5. कुल बकाया धनराशि" and "8. शुद्ध वसूल की जाने वाली धनराशि" are **not** columns — computed
client-side, see Calculation Logic below.

**Data-entry scope**: the portal only tracks dues from cases that originated up to FY ending
31-Mar-2019 — a static bilingual banner near the district selector, not a live date check (dues
can predate the 1970s).

## Calculation Logic

Computed reactively client-side in both `index.html` and `admin.html`, same formulas:

1.  **कुल बकाया धनराशि (Total Dues Left)** = `total_dues − collected_till_date − collected_after_date`
2.  **शुद्ध वसूल की जाने वाली धनराशि (Net Recoverable)** = `max(0, Total Dues Left − batte_khatte_amount − court_stayed_amount)`
3.  **Submit is disabled** if `batte_khatte_amount > Total Dues Left`, or
    `court_stayed_amount > (Total Dues Left − batte_khatte_amount)`.

## DEO Flow (`login.html` → `index.html`)

1.  **Login (`login.html`)** — DEO enters their 10-digit CUG mobile number. Client-side checks:
    must start with `94544` (the department's real prefix) *or* hash to the seeded demo account's
    `DEMO_CUG_HASH` — exempted by hash, not by number, so the raw demo number never appears in
    source (ask an admin for it if you need to test). The number is SHA-256-hashed in-browser
    (Web Crypto) — the raw number never leaves the device — and the hash is POSTed to
    `/verify-deo`. Errors render inline under the field, not as a popup.
2.  **Session** — on success, the Worker signs a district-bound token and sets it as an
    `HttpOnly; Secure; SameSite=None` cookie (`deo_session`), and returns `district_id` in the
    JSON body. The frontend stores that id in `localStorage` (`cug_verified_district_id`) purely
    to auto-select the dropdown and skip re-login on revisit — the cookie, not localStorage, is
    what the server actually trusts.
3.  **`index.html`** redirects to `login.html` if no `cug_verified_district_id` is in
    `localStorage`. Otherwise the district dropdown is pre-selected and disabled, so a DEO
    physically cannot pick another district.
4.  **Data entry** — all DEO-input fields (`collected_after_date`, both count/amount pairs) start
    **blank**, not `0`. An explicit `0` is a valid answer; leaving a field blank and submitting is
    not — it's blocked with an inline SweetAlert2 toast ("Field left blank / फ़ील्ड खाली है"),
    never silently coerced to zero.
5.  **Locking** is a two-step confirm: a plain "are you sure, have you checked the data" dialog,
    then a name-entry prompt with a liability disclaimer (English + Hindi — locking makes the
    submitting DEO personally responsible for the figures) validated by `validateDeoName()`
    (rejects blank input, digits — guards against a pasted CUG number — and designation words like
    "DEO" typed in place of an actual name).
6.  **Submit** — `POST /` sends the session cookie automatically (`credentials: 'include'`); the
    Worker verifies it and rejects (403) if the token's district doesn't match the row being
    written, even if the caller has a valid `X-API-Secret`. A 403 here means the session expired
    (24h TTL) — the DEO is bounced back to `login.html` to re-verify.
7.  **Post-lock** the form is replaced by a locked-notice banner; only an Admin unlock re-enables
    it.
8.  **Logout** clears the cookie server-side (`POST /deo-logout`) and the localStorage flag, then
    redirects to `login.html`.

## Admin Flow (`admin.html`)

*   **PIN auth** — a separate flow from DEO CUG login; checked against the `ADMIN_PIN` Wrangler
    secret via `POST /auth`, throttled to 10 attempts per 15 minutes per IP. On success, the
    Worker signs a role-bound session token and sets it as an `HttpOnly; Secure; SameSite=None`
    cookie (`admin_session`) — `sessionStorage`'s `admin_auth` flag is only a client-side "skip
    the PIN prompt this tab" convenience; the cookie is what the server actually checks.
*   **Unlock** — resets `is_locked` to 0 for a district (`POST /unlock`), with a Hindi confirm
    dialog, so a DEO can re-submit. Requires the `admin_session` cookie (403 without it).
*   **Truncate Demo** — `POST /truncate-demo` deletes only the row where
    `district_name = 'Demo District'`, hardcoded server-side — used once, right before real DEOs
    get the portal URL, to remove the account used for end-to-end testing. Also requires the
    `admin_session` cookie.
*   **Logout** clears the cookie server-side (`POST /admin-logout`) before clearing
    `sessionStorage`.
*   **Offline cache** (Dexie) for instant reloads, with a manual Sync button and an
    auto-sync-then-export on both export actions.
*   **Excel export** (`xlsx-js-style`) — frozen header rows + first column, a summed totals row,
    Indian Rupee formatting, generation timestamp in the header.
*   **SQL export** — a timestamped `.sql` file of `UPDATE` statements for the whole dataset.

## API (`worker.js`)

Every route requires `X-API-Secret` matching the `API_SECRET` Wrangler secret — a coarse bot
filter, not a real per-user credential (see CLAUDE.md's Auth section for why, and what actually
gates writes). In-memory sliding-window rate limiting (60 req/min per `cf-connecting-ip`, HTTP
429 past that; the tracking `Map` self-clears past 5000 entries to bound memory).

CORS is locked to the `FRONTEND_URL` Wrangler var (exact match, not a wildcard) with
`Access-Control-Allow-Credentials: true` — required for the cross-site `deo_session`/
`admin_session` cookies (Pages and Workers are separate origins).

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | All district records (used for the DEO dropdown and the Admin table). |
| `/` | POST | DEO submits + locks a district. Requires a `deo_session` cookie whose district matches `body.id` — see Auth. |
| `/auth` | POST | Admin PIN check; throttled 10/15min per IP. Sets `admin_session` on success. |
| `/unlock` | POST | Admin resets a district's lock. Requires `admin_session`. |
| `/truncate-demo` | POST | Admin deletes the `Demo District` row only. Requires `admin_session`. |
| `/verify-deo` | POST | CUG hash lookup; on success, sets the `deo_session` cookie. |
| `/deo-logout` | POST | Clears the `deo_session` cookie. |
| `/admin-logout` | POST | Clears the `admin_session` cookie. |

## Scripts and Data (`scripts_and_data/`)

`.gitignore` excludes `*.sql`, `*.csv`, `*.txt`, `*.py`, and anything matching `*hash*` under this
directory — the department's contact directory (real officer names, phone numbers, CUG numbers)
lives here locally only, never in git. See CLAUDE.md's Security section for what happened when
this wasn't enforced and how it was fixed.

## Setup and Deployment

1.  **Local D1**:
    ```bash
    cd api
    npx wrangler d1 execute excise-bakaya-db --local --file=./schema.sql
    npx wrangler d1 execute excise-bakaya-db --local --file=./import.sql
    ```
2.  **Local secrets** (`api/.dev.vars`, gitignored):
    ```
    API_SECRET="..."
    ADMIN_PIN="..."
    JWT_SECRET="..."
    ```
3.  **Local worker**: `cd api && npx wrangler dev`
4.  **Local frontend**: serve `/frontend` with any static server (e.g. `npx serve frontend`).
5.  **Remote secrets** (one-time, or on rotation): `npx wrangler secret put JWT_SECRET` (and
    `API_SECRET`/`ADMIN_PIN`) from `/api`. `FRONTEND_URL` is a plain (non-secret) var in
    `wrangler.toml`.
6.  **Deploy API**: `cd api && npx wrangler deploy`.
7.  **Deploy frontend**: push to `main` — Cloudflare Pages auto-deploys from the GitHub
    integration; no manual `wrangler pages deploy` needed.
