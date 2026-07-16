# V2 Plan — Excise Bakaya Tracker

Source data: `scripts_and_data/Excise_Bakaya_Report_02-07-2026_12-39-31.xlsx`, sheet `Excise_Bakaya`, 59 district rows + 1 TOTAL row. Columns: District Name, Total Dues, Collected Till 13-Nov-25, Collected After 13-Nov-25, Batte Khatte Count, Batte Khatte Amount, Court Stayed Amount, Total Dues Left, Net Recoverable Target, Status, DEO Name, Locked At.

## 1. Data refresh (re-baseline from Excel)

- **`total_dues`** — take as-is from Excel `Total Dues` column, per district. No formula change.
- **New baseline collected figure** — sum `Collected Till 13-Nov-25` + `Collected After 13-Nov-25` per district → this becomes the new "collected till PAC meeting" baseline, re-labeled **08-Jul-2026** (the actual PAC meeting date). Form label: "08-Jul-26 तक वसूल की गई धनराशि".
  - Verified against your check total: `75,239,949.33 + 6,780,552.80 = 82,020,502.13` ✅ matches the INR 82,020,502 UP-wide total you gave.
  - No new column needed — reuse the existing `collected_till_date` column (it already means "collected as of the baseline cutoff"), just re-seed its value to the new sum and relabel the form. `collected_after_date` resets to 0 for the new DEO entry cycle (same field, new cycle), and districts get re-locked as DEOs re-submit against the new baseline.
- Upload: one-time re-seed of all 59 district rows with the new `total_dues` and `collected_till_pac_date` values (local D1 only, per your standing instruction — nothing touches remote/live D1 until you say go).

## 2. New field: Court Case Count

- Today: `court_stayed_amount` exists, but no count — unlike Batte Khatte which has both `batte_khatte_count` and `batte_khatte_amount`.
- Add **`court_case_count`** (INTEGER), entered by the DEO alongside `court_stayed_amount`, mirroring Batte Khatte's UI/validation/lock logic exactly (same math-safety check pattern as `calculateMath()` in [index.html](frontend/index.html)).

## 3. Data-entry cutoff — CONFIRMED: scope banner, no date logic

Confirmed reading (A): this portal only tracks dues from cases that *originated* up to FY ending 31-Mar-2019 — start date can be anything (dues go back to the 1970s). No live date check anywhere. Just a static bilingual disclaimer banner near the district selector, same pattern as the reference project's banners.

## 4. Security/UX upgrades — ported from `excise-revenue-recovery-portal` (all CONFIRMED)

| # | Item | Decision |
|---|---|---|
| 1 | **DEO name validation** — regex rejects digits, rejects designation words ("DEO", "officer", "admin" via `/\b(deo|adeo|officer|admin)\b/i`), requires `/^[A-Za-z][A-Za-z.\-' ]*$/` | ✅ Build — add to `inputValidator` on lock-confirmation SweetAlert2 prompt in [index.html](frontend/index.html) (currently only checks non-empty) |
| 2 | **Hindi warning dialogs** — one bilingual SweetAlert2 prompt per destructive/confirm action, red button cues | ✅ Build — for locking a record, admin unlock, admin truncate-demo, and the new scope-cutoff banner |
| 3 | **CUG hashing moved client-side** — SHA-256 via Web Crypto computed in-browser before the number leaves the device; server only ever sees the hash | ✅ Build — move hashing from [worker.js:130-135](api/worker.js) into `index.html`, server just does the lookup |
| 4 | **JWT/session hardening for DEO route** | ❌ Skip — confirmed the reference project's JWT is admin-only, not DEO. No session-token layer added to the POST /save route for now; DEO flow stays CUG-hash-verify + localStorage flag as today. |

## 5. Schema update — CONFIRMED: bring schema.sql fully current

- [api/schema.sql](api/schema.sql) was stale in two ways, both being fixed now:
  - Missing `deo_name`, `locked_at`, `cug_hash` — these already exist on the live table (confirmed via `PRAGMA table_info` on production-parity checks) but were never captured in the repo's schema file, meaning **local dev D1 didn't actually have them either** (local was built purely from this stale file) — `/verify-deo`, `/unlock`, and record-locking would break on a fresh local setup.
  - Missing the new `court_case_count` column for §2.
- `schema.sql` rewritten as the full authoritative `CREATE TABLE` (used for fresh installs / local resets).
- A separate additive-only migration (`api/migrations/002_court_case_count.sql`, plain `ALTER TABLE ADD COLUMN`, no drops) is kept ready for whenever you say go on remote — since remote already has `deo_name`/`locked_at`/`cug_hash`, it only needs the one new column.

## Final schema diff

```sql
-- schema.sql (fresh installs / local reset) adds vs. before: deo_name, cug_hash, locked_at, court_case_count
-- migrations/002_court_case_count.sql (additive, safe for remote when you say go):
ALTER TABLE excise_dues ADD COLUMN court_case_count INTEGER DEFAULT 0;
```

All of this has been implemented locally only (`--local` D1, re-seeded from the Excel data above, verified sum ₹82,020,502.13 across 59 rows). Remote/live D1 untouched.

## Status (superseded — see §8): originally shipped locally-only

- `api/schema.sql` — rewritten, full authoritative schema, applied to local D1 via `DROP`+`CREATE` (local only, no real data at risk).
- `api/import.sql` — regenerated from the Excel export with the new baseline (`total_dues`, `collected_till_date` = sum of old two columns), applied to local D1.
- `api/migrations/002_court_case_count.sql` — additive `ALTER TABLE`.
- `api/migrations/003_v2_baseline_reseed.sql` — 59 non-destructive `UPDATE ... WHERE district_name = ...` statements (only touches `total_dues`/`collected_till_date`, leaves `is_locked`/`deo_name`/`locked_at`/`cug_hash` alone).
- `api/worker.js` — CUG verification now expects a pre-hashed `cug_hash` from the client instead of a raw `cug` number; save route now accepts/stores `court_case_count`.
- `frontend/index.html` — relabeled to "08-Jul-26", added Court Case Count field, DEO-name regex validator, client-side SHA-256 CUG hashing, Hindi lock/logout confirmations, scope-eligibility banner (31-Mar-2019).
- `frontend/admin.html` — relabeled columns, added Court Case Count to table/totals/Excel export/SQL export, Hindi unlock/truncate-demo confirmations.

All of the above is now live on remote — see §8 for the actual rollout (which also fixed two more district names and added a real session-auth layer beyond what's described here).

## 6. CUG prefix check, district-name fix, DEO email, leaked contact.csv

- **CUG prefix validation** — ported from `excise-revenue-recovery-portal/frontend/app/login/page.tsx`: all real Excise Dept. CUG mobile numbers start with `94544`. Added a client-side `inputValidator` check in [frontend/index.html](frontend/index.html) (`CUG_PREFIX = '94544'`) before the number is even hashed, so obviously-wrong numbers are rejected before a network round-trip. Hashing (SHA-256 via Web Crypto) and the `/verify-deo` hash-only lookup were already in place from §4.
- **District name fix: `Allahabad` → `Prayagraj`** — the source Excel genuinely lists 59 districts under the old name `Allahabad` (renamed to Prayagraj in 2019), but `contact.csv`/`emails.csv` (and the reference project) use `प्रयागराज` → `Prayagraj`. Renamed in `import.sql`, `schema.sql`-driven local D1, and prepended a rename statement to `api/migrations/003_v2_baseline_reseed.sql` (must run before that file's `Allahabad` UPDATE, which itself is now targeted at `Prayagraj`) so remote gets the same fix when you say go.
- **`deo_email` column** — added (nullable `TEXT`), mirroring the reference project's `users.email`, but scoped to only the 59 districts this repo tracks (not the full 75). Additive migration: [api/migrations/004_deo_email_column.sql](api/migrations/004_deo_email_column.sql) (not yet run on remote).
- **CUG hash + email provisioning data** — real CUG mobile numbers (hashed) and DEO emails, sourced from `scripts_and_data/contact.csv` + `emails.csv`, matched against our 59 districts via the same Hindi→English mapping the reference project uses. Generated into `scripts_and_data/deo_seed.sql` (gitignored — see below) and applied to local D1: all 59 districts now have `cug_hash`/`deo_email` populated (previously **entirely NULL locally**, meaning no DEO could log in on a fresh local setup until now). Not yet run on remote.
- **Security fix: leaked `contact.csv`** — `scripts_and_data/contact.csv` (real officer names + CUG mobile numbers for the whole department) was already committed and pushed to the public GitHub repo. `git rm --cached` on it plus `generated.txt`/`in_db.txt`/`map_cug.py`, and `.gitignore` extended with `scripts_and_data/*.csv`, `*.txt`, `*.py` to match the reference project's gitignore and stop this from recurring. **The old commits still contain it in git history** — that needs a separate history rewrite (not done here) if you want it fully scrubbed, since that's a destructive/force-push operation.

Status: superseded by §8 — all of this (plus the `Kheri` → `Lakhimpur Kheri` fix caught in the same rollout) is now live on remote.

## 7. DEO login page, inline validation, blank-by-default fields, two-step confirm

- **Bug found in prod testing**: the CUG login `Swal.fire({ input: 'tel' })` had no `maxlength`, so it visually accepted 20+ digits typed into a "10-digit" field — caught by screenshot during the user's own testing pass on `excise-bakaya-form.pages.dev`.
- **`frontend/login.html`** (new) — DEO-only CUG login as its own page instead of a blocking modal on `index.html`, mirroring `excise-revenue-recovery-portal`'s `/login` page (no admin/email tab here — Admin PIN stays on `admin.html`). CUG entry has `maxlength="10"`, `inputmode="numeric"`, and a strip-non-digits listener; errors render **inline** under the field (a red banner div), not a SweetAlert2 popup — matches the reference project's `Banner`-based pattern ("validation stays inline, SweetAlert2 reserved for irreversible-action confirms"). `index.html` now just checks `localStorage` for a verified session and redirects to `login.html` if absent; all the CUG prefix/hash/demo-exemption logic that used to live in `index.html`'s modal moved here.
- **Blank-by-default DEO fields** — `collected_after_date`, both count/amount pairs now reset to `''` on district select instead of `'0'`. Submitting with any left blank is blocked by a SweetAlert2 **toast** (`notifyToast()`, added to `index.html`), not the native HTML5 `required` popup (removed from all 5 fields) and not silently coerced to `0` — mirrors the reference project's `blankYear()`/`BLANK_FIELD_TITLE` pattern exactly, including that this specific check stays a toast (not inline), since it's not tied to one field.
- **Two-step lock confirm** — splits the old single "type your name to lock" prompt into a plain "are you sure, have you checked the data" confirm first, then the existing name-entry prompt, mirroring `confirmFinalSubmit()`/`promptDeoNameAndLock()`. The name-entry prompt's disclaimer text was also rewritten to the reference project's more detailed, bilingual, personal-liability wording.

## 8. Real session auth: httpOnly cookie + district-bound token, remote rollout, git history scrub

Everything below is **live on remote** as of this rollout — not a plan, a record of what shipped.

- **Git history scrub**: `scripts_and_data/contact.csv` (real officer names + CUG mobile numbers) had been committed and pushed to the public repo before `.gitignore` excluded `*.csv`/`*.txt`/`*.py` under `scripts_and_data/`. Untracked, then fully removed from every commit via `git-filter-repo` (verified via `git ls-tree` across all history — zero remaining matches) and force-pushed to `origin/main`.
- **Two more district-name fixes** caught while reseeding remote: `Baghpat` was already correctly cased (nothing to fix); `Kheri` → `Lakhimpur Kheri` was not, alongside the already-planned `Allahabad` → `Prayagraj`.
- **Remote D1 truncated and reseeded**: all 59 districts got fresh `total_dues`/`collected_till_date` (08-Jul-2026 baseline, verified sum ₹518,776,884.21 / ₹82,020,502.13), `cug_hash`/`deo_email` populated for every district, `deo_name` cleared, every row unlocked, plus a `Demo District` row (CUG exempted by hash — see CLAUDE.md's Security section for why the raw number isn't written anywhere) for end-to-end pre-launch testing.
- **Real per-district session auth**: `X-API-Secret` was always a Wrangler secret server-side, but as a static frontend it has to be embedded client-side to be sent at all — never actually secret, just a bot filter. The real gap: `POST /` trusted any caller holding that value to write to *any* district by id, with no check they'd ever verified a CUG for it. Fixed the way `excise-revenue-recovery-portal` does it: `/verify-deo` now signs a district-bound session token (HMAC-SHA256 via `crypto.subtle` — no new dependency, see `worker.js`) and sets it as an `HttpOnly; Secure; SameSite=None` cookie. CORS switched from a wildcard to an exact `FRONTEND_URL` match + `Access-Control-Allow-Credentials`, required for the cross-site cookie (Pages and Workers are separate origins). `POST /` now requires this cookie and 403s if its district doesn't match the row being written — verified live: no cookie → 403, cookie for a different district → 403, matching cookie → succeeds. Added `/deo-logout` to clear it server-side. `GET /` (district dropdown pre-login, and the Admin dashboard, which has no DEO session) is untouched.
- New Wrangler secret: `JWT_SECRET`. New non-secret var: `FRONTEND_URL` (`wrangler.toml`).
- Worker deployed, frontend pushed (Cloudflare Pages auto-deploys from `main`) — both confirmed live and matching via smoke test.

**Trade-off noted, not yet acted on**: `SameSite=None` cross-site cookies between two different public-suffix domains (`pages.dev`, `workers.dev`) are exactly what Safari ITP and Chrome's third-party-cookie deprecation target — same open risk the reference project already carries with an identical setup. If a DEO reports "login succeeds but save always fails," check this before assuming the token logic is broken. The real fix would be collapsing both apps onto one zone; not done here since it's a bigger change than this round's scope.

See [CLAUDE.md](./CLAUDE.md) for the durable rules this rollout established (district-name authority, auth boundary, security incident, validation rules) — this file stays a chronological record, CLAUDE.md is what future agents should actually follow.

## 9. Admin auth hardening

Same gap as §8 found on the Admin side: `/unlock` and `/truncate-demo` were gated only by
`X-API-Secret` (necessarily public) — the PIN prompt in `admin.html` was purely a client-side UI
gate, never checked server-side. Anyone reading `X-API-Secret` out of view-source could unlock or
truncate-demo directly via curl, no PIN needed.

Fixed with the same pattern as the DEO session, reusing the same signing helpers (generalized
`signToken`/`verifyToken` in `worker.js`, with `signDeoToken`/`signAdminToken` as the two payload
shapes — no new dependency, no new secret, `JWT_SECRET` covers both): `/auth` now signs a
role-bound `admin_session` cookie on a correct PIN; `/unlock` and `/truncate-demo` require it and
403 without it. Added `/admin-logout` to clear it. `admin.html`'s `sessionStorage` flag is
unchanged as a same-tab UI convenience, but no longer anything the server trusts.

Also throttled `/auth` specifically (10 attempts / 15 min per IP, separate map from the general
rate limiter) — the general 60 req/min limit would let a 4-digit PIN (10,000 combinations) be
brute-forced in well under three hours.

Verified locally via `wrangler dev`: `/unlock`/`/truncate-demo` 403 with no cookie, 200 with a
valid `admin_session` cookie; wrong PIN still 401; 11th `/auth` attempt in a 15-minute window
returns 429.

## 10. Excel export: ExcelJS swap; Admin login page

- **Bug found comparing against `excise-revenue-recovery-portal`**: that project deliberately
  moved its Excel export off `xlsx-js-style` (the exact library `admin.html` still used) onto
  ExcelJS, with a code comment explaining why — neither stock `xlsx` nor the `xlsx-js-style` fork
  write frozen-pane XML at all, confirmed by inspecting the actual output file. Our
  `ws['!views'] = [{ state: 'frozen', ... }]` call was a silent no-op; there was also no page
  setup at all (no paper size/orientation/fit-to-width/print-titles), which that same
  SheetJS-community core can't write either.
  - **Fix**: swapped the CDN script (`xlsx-js-style@1.2.0` → `exceljs@4.4.0`, same version the
    recovery portal already runs in production) and rewrote `exportToExcel()` in `admin.html`
    against ExcelJS's API. Same single-sheet layout (title banner, header, per-district rows,
    green TOTAL row, ₹ currency format) as before, plus: real frozen title+header rows, A4
    landscape with fit-to-width, and a repeated header row (`_xlnm.Print_Titles`) on multi-page
    printouts.
  - **Verified, not assumed**: ported the exact cell-building logic into a throwaway Node script
    against the `exceljs` npm package, wrote a real `.xlsx`, unzipped it, and grepped
    `xl/worksheets/sheet1.xml` for the actual `<pane .../>` element and `<pageSetup .../>`, plus
    `xl/workbook.xml` for the `_xlnm.Print_Titles` defined name — all three present and correct
    before touching the shipped file.
- **`frontend/admin-login.html`** (new) — Admin PIN login as its own full page, mirroring
  `login.html`'s visual design (card, brand badge, inline `#loginError` banner) but red-accented
  and PIN-only, no CUG/DEO option. `admin.html`'s `authenticateAdmin()` no longer shows a blocking
  `Swal.fire({ input: 'password' })` prompt on a blurred dashboard — it just checks
  `sessionStorage`'s `admin_auth` flag and redirects to `admin-login.html` if absent, same pattern
  `index.html`/`login.html` already used for the DEO side. `logoutAdmin()` and
  `sessionExpiredAdmin()` redirect there too instead of `location.reload()`.
- Root `/` (`index.html`) already redirected unauthenticated visitors to `login.html` (added in
  §7) — no change needed there, just confirmed it's the DEO-side equivalent of what
  `admin.html` → `admin-login.html` now does for Admin.

Local testing: static file server confirmed all 5 pages (`login.html`, `index.html`,
`admin-login.html`, `admin.html`, plus the ExcelJS CDN swap) serve and parse without JS syntax
errors before deploy.

## 11. DEO Save Fix & GitHub Actions Deployment Setup

- **DEO Save/Submit Fix**: Fixed a critical runtime bug where the `POST /` save route crashed with a `ReferenceError` due to calling an undefined function `verifyDeoToken` instead of `verifyToken` in `api/worker.js`.
- **GitHub Actions Workflows (`.github/workflows/`)**:
  - Configured `ci.yml` to validate JS syntax (`node --check`) for the Worker and verify frontend file availability on every push and PR to the `main` branch.
  - Configured `deploy.yml` to automatically build/deploy both the API (using `pnpm` and `pnpm run deploy` via v11) and the frontend (via `npx wrangler pages deploy frontend`) to Cloudflare upon pushing to the `main` branch. Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- **UX Improvements**:
  - **Count Input Placeholders**: Changed the `placeholder="0"` on the count inputs to `placeholder="Type 0 if none"` to prevent users from mistaking a blank field for a pre-filled `0`, which previously triggered the anti-blank validation error.
  - **District Select Removal**: Replaced the legacy interactive `<select>` dropdown for districts with a static text heading (`District: <Name>`). Since the DEO is securely authenticated via their CUG number, the district is inherently locked to their session, rendering the dropdown UI redundant. The subsequent form fields were re-numbered from 1 to 7.

