# CLAUDE.md — UP Excise Bakaya Tracker

Instructions for AI agents working in this repo. [.agents/AGENTS.md](./.agents/AGENTS.md) has the
core directives (stack limits, no new frameworks without permission, no schema/math changes
without instruction) — read that too. See [README.md](./README.md) for what the system does and
[v2plan.md](./v2plan.md) for the v2 change history. This file documents rules to preserve, not a
build log.

## What this is

Government portal (Excise Dept., Uttar Pradesh) for 59 District Excise Officers (DEOs) to submit
one round of dues-recovery figures, and for an Admin to review/export/unlock it. One submission
per district is final: once a DEO locks, it cannot be re-edited without an Admin unlock. Built as
a fast, no-build-step static site + a single Worker file — not a framework app. Keep changes in
that spirit: the smallest diff that works, not a rewrite toward more structure.

## Repo shape

`/frontend` (three plain HTML files, Cloudflare Pages, auto-deploys from `main` via GitHub
integration — pushing to `main` *is* the deploy, no manual `wrangler pages deploy` step) and `/api`
(one `worker.js`, Cloudflare Workers + D1) are separate origins in production
(`excise-bakaya-form.pages.dev` / `excise-bakaya-api.shubhanraj2002.workers.dev`). No shared
package, no bundler on either side — `worker.js` is deployed as-is by `wrangler deploy`, HTML
files load every dependency from a CDN `<script>` tag.

**Never run a destructive Wrangler D1 command with `--remote`, and never `wrangler deploy`/push to
`main`, without the user explicitly saying so for that specific change.** Local `--local` D1 work
and local testing (`wrangler dev`) don't need to ask. This project has live production data and
real government users; the user has been explicit and repeated about this boundary — treat every
remote/deploy action as requiring a fresh go-ahead, not a standing one from a past turn.

## Data model

See [README.md](./README.md)'s Database Schema section for the full column reference. Rules to
preserve:

- **District names are current official names**, not the source Excel's literal strings:
  `Prayagraj` (not `Allahabad`), `Lakhimpur Kheri` (not `Kheri`). The Excel report and the
  department's Hindi contact directory don't agree on these — the contact directory (and reality)
  wins. If a future data refresh reintroduces an old name, rename it, don't re-add a duplicate row.
- `total_dues` and `collected_till_date` are read-only, sourced from the department's periodic
  Excel exports (`scripts_and_data/*.xlsx`) — never computed or DEO-editable.
  `collected_till_date` currently means "collected as of 08-Jul-2026" (the PAC meeting baseline);
  if a future re-baseline moves this date, re-seed the column's value and relabel the UI ("3. ...
  तक वसूल की गई धनराशि") rather than adding a new column — this project reuses columns across
  baselines by design (see v2plan.md §1).
- `court_case_count`/`court_stayed_amount` mirrors `batte_khatte_count`/`batte_khatte_amount`
  exactly (same UI layout, same DEO-input treatment) — keep them structurally identical if you add
  a third such pair.
- **`Demo District`** is a real row (not a special-cased id), used only for pre-launch end-to-end
  testing. `/truncate-demo` is hardcoded server-side to
  `WHERE district_name = 'Demo District'` — never parameterize this route, the whole point is that
  it's physically incapable of deleting a real district even given a bad request body.
- **Data-entry scope**: only dues from cases originating up to FY ending 31-Mar-2019 are meant to
  be tracked here. This is a static bilingual disclaimer banner near the district selector, not a
  live date check — dues can predate the 1970s, so don't add logic that rejects entries based on
  today's date.

## Auth

See [README.md](./README.md)'s DEO Flow / Admin Flow / API sections for the request-level
overview. Rules to preserve:

- **`X-API-Secret` is not a real per-user credential and never will be** — it's embedded in every
  frontend HTML file's source (unavoidable: this is a static site with no server-side templating),
  so anyone can read it from view-source. Treat it only as a coarse bot/scraper filter. **Never
  design a security boundary that assumes `X-API-Secret` alone proves anything about who the
  caller is.**
- **The real per-district write boundary is the `deo_session` cookie**, set by `/verify-deo` on a
  successful CUG hash match: an HMAC-SHA256-signed, district-bound, 24-hour token (hand-rolled via
  `crypto.subtle`, not a JWT library — see the "Minimal HMAC-signed session token" comment in
  `worker.js`). `POST /` verifies this cookie and 403s if its `districtId` doesn't match
  `body.id`, even with a valid `X-API-Secret`. If you add another DEO-write route, it must perform
  this same check — don't let a new route trust `body.id`/`body.district_id` on its own.
- **`JWT_SECRET`** (Wrangler secret) signs that cookie, and the admin one below (`signToken`/
  `verifyToken` are the shared generic helpers; `signDeoToken`/`signAdminToken` just fix the
  payload shape). **`FRONTEND_URL`** (plain var in `wrangler.toml`) is the CORS allowlist —
  `Access-Control-Allow-Origin` is only ever set to an exact match against it, never a wildcard,
  because both cookies require `Access-Control-Allow-Credentials: true` and the fetch spec
  forbids combining that with `*`. Every frontend fetch that needs a cookie sent must pass
  `credentials: 'include'` (`login.html`'s `/verify-deo` call; `index.html`'s `POST /` and
  `/deo-logout`; `admin-login.html`'s `/auth`; `admin.html`'s `/unlock`, `/truncate-demo`,
  `/admin-logout`) — a route added without this will silently fail to receive/send the cookie.
- **Admin auth is a separate system from the DEO session** (`ADMIN_PIN` Wrangler secret, `/auth`
  route) — an Admin and a DEO can be logged in in the same browser simultaneously, entirely
  separate login pages (`admin-login.html` vs. `login.html`), no shared session. It is **not**
  PIN-only, though: `/auth` on success also signs an `admin_session` cookie (role-only payload, no
  district), and `/unlock`/`/truncate-demo` require it (403 without it) — `isAdminSession()` in
  `worker.js`. `sessionStorage`'s `admin_auth` flag is a client-side UI convenience only (skip
  `admin-login.html` if already set this tab); it proves nothing to the server. If you add another
  admin-only write route, it must call `isAdminSession()` too — don't let a new admin route trust
  `X-API-Secret` alone, same rule as the DEO side. `/auth` also throttles PIN attempts specifically
  (10 per 15 min per IP, separate from the general rate limiter) since a 4-digit PIN is only 10,000
  combinations.
- **Known open risk** (same class of issue as `excise-revenue-recovery-portal`, a sibling project
  with an identical cross-origin cookie setup): `SameSite=None` cross-site cookies between two
  different public-suffix domains (`pages.dev`, `workers.dev`) are exactly what Safari ITP and
  Chrome's third-party-cookie deprecation target. If a DEO reports "verify succeeds but every save
  gets 403," check whether their browser is silently dropping the cookie before assuming the token
  logic is broken. All four `Set-Cookie` headers in `worker.js` carry the `Partitioned` attribute
  (CHIPS) as a mitigation — this keeps the cookie alive under Chrome's third-party-cookie
  deprecation, but does **not** help Safari, which blocks third-party cookies outright regardless
  of `Partitioned`/`SameSite`. The only full fix is moving frontend and API onto the same
  registrable domain (e.g. a custom domain with `app.` / `api.` subdomains) so the cookie becomes
  first-party — out of scope until this project has a custom domain.
- `GET /` and the admin-only routes (`/auth`, `/unlock`, `/truncate-demo`) are intentionally
  **not** gated by the DEO session cookie — `GET /` is used pre-login to populate the district
  dropdown and by the Admin dashboard (which has no DEO session at all). Don't add a cookie
  requirement to `GET /`.

## Security

`scripts_and_data/contact.csv` (the department's real officer names + CUG mobile numbers) was
committed to this public repo before `.gitignore` excluded `*.csv`/`*.txt`/`*.py` under that
directory. It was untracked and scrubbed from git history with `git-filter-repo` + force-push.
**Never commit anything under `scripts_and_data/` that isn't already gitignore-excluded by
pattern** — check `.gitignore`'s `scripts_and_data/*.sql`, `*.csv`, `*.txt`, `*.py`, `*hash*`
rules before adding a new data-processing script or export there; if a new file type doesn't match
an existing pattern, add the pattern rather than committing the file. The demo CUG number
(`DEMO_CUG_HASH`'s preimage) follows the same rule — it's exempted by hash specifically so the raw
value never needs to appear in source; don't add it to a doc, comment, or commit message.

## Validation rules

1. **Anti-blank rule**: DEO-input fields (`collected_after_date`, both count/amount pairs) start
   **blank** on district select, never pre-filled with `0` — an explicit `0` must be typed
   deliberately. Submitting with any of these still blank is blocked by a SweetAlert2 toast
   (`notifyToast()` in `index.html`), not a native HTML5 `required` popup (removed on purpose —
   see the field `<input>` tags, none carry `required`) and not silently coerced to `0`. If you add
   a new DEO-input field, default it to `''`/blank and add it to the blank-check list in the
   `duesForm` submit handler.
2. **DEO name** (`validateDeoName()`, both `index.html` and `login.html`'s equivalent checks where
   relevant): rejects blank, digits (guards against a pasted CUG number), designation words
   ("DEO"/"officer"/"admin" etc. via whole-word regex), and non-letter characters.
3. **Math-safety submit gate**: the "Verify & Lock Record" button is disabled if
   `batte_khatte_amount > Total Dues Left` or
   `court_stayed_amount > (Total Dues Left − batte_khatte_amount)` — see README's Calculation
   Logic. Mirror this in any new deduction-style field pair.
4. **Two-step lock confirm**: a plain "are you sure" dialog, then the name-entry + liability-
   disclaimer prompt (bilingual, mirrors `excise-revenue-recovery-portal`'s
   `confirmFinalSubmit`/`promptDeoNameAndLock`). Don't collapse this back to one dialog — the
   split is deliberate (matches the reference project, gives a DEO a genuine second chance to
   cancel before the irreversible name-entry step).

## UI conventions

- **Language**: bilingual Hindi/English throughout the DEO-facing UI (labels, disclaimers,
  confirms) — this mirrors the actual government form, unlike `excise-revenue-recovery-portal`
  (English-only UI chrome). Don't strip Hindi from DEO-facing strings.
- **Feedback split**: field-level/login errors render **inline** (a red banner under the field —
  see `login.html`'s and `admin-login.html`'s `#loginError`), not as a popup. Multi-field or
  non-field-specific validation errors (e.g. "some field is blank, could be any of five") use a
  SweetAlert2 **toast** (`notifyToast()`). SweetAlert2 **modals** (`Swal.fire` without
  `toast: true`) are reserved for blocking confirms before an irreversible action — locking a
  record, admin unlock, truncate-demo, logout. Don't add a new blocking modal for a routine
  validation message; don't add a new inline banner for an irreversible-action confirm.
- **No emojis anywhere in the UI** — Tabler Icons (webfont) only.
- **₹ prefix** on every financial amount, Indian Lakh/Crore grouping via Cleave.js on DEO-input
  money fields — don't hand-roll number formatting.
- **Excel export uses ExcelJS, not a SheetJS-family library.** `xlsx`/`xlsx-js-style`'s community
  core silently drops frozen-pane and print-layout XML — confirmed both here and in
  `excise-revenue-recovery-portal` by inspecting the actual output file. If you touch
  `exportToExcel()` in `admin.html`, verify any `!views`/page-setup-equivalent change with a real
  unzip-and-grep of the generated `.xlsx` (`<pane .../>`, `<pageSetup .../>` in
  `xl/worksheets/sheet1.xml`), not just "no error thrown" — a silently no-op call is the exact bug
  this was fixed for.
- Destructive/irreversible admin actions (unlock, truncate-demo) use a red (`#dc2626`) confirm
  button and Hindi cancel text, matching the DEO-side lock/logout dialogs.

## Known gaps / intentionally out of scope

- No CI — deploys are a human (or agent, with explicit go-ahead) running `wrangler deploy` /
  pushing to `main`. If this project ever gets a GitHub Actions workflow, remove the "push to main
  IS the deploy" framing above and document the new flow instead.
- Git history was scrubbed once (see Security above); it is not scrubbed automatically going
  forward — a future accidental commit of a gitignored-pattern-violating file still needs the same
  manual `git-filter-repo` + force-push treatment, this repo has no pre-commit hook preventing it.
