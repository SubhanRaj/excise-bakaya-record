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

## Status: implemented locally, ready for remote when you say go

- `api/schema.sql` — rewritten, full authoritative schema, applied to local D1 via `DROP`+`CREATE` (local only, no real data at risk).
- `api/import.sql` — regenerated from the Excel export with the new baseline (`total_dues`, `collected_till_date` = sum of old two columns), applied to local D1.
- `api/migrations/002_court_case_count.sql` — additive `ALTER TABLE`, **not run on remote**, ready when you say go.
- `api/migrations/003_v2_baseline_reseed.sql` — 59 non-destructive `UPDATE ... WHERE district_name = ...` statements (only touches `total_dues`/`collected_till_date`, leaves `is_locked`/`deo_name`/`locked_at`/`cug_hash` alone), **not run on remote**, ready when you say go.
- `api/worker.js` — CUG verification now expects a pre-hashed `cug_hash` from the client instead of a raw `cug` number; save route now accepts/stores `court_case_count`.
- `frontend/index.html` — relabeled to "08-Jul-26", added Court Case Count field, DEO-name regex validator, client-side SHA-256 CUG hashing, Hindi lock/logout confirmations, scope-eligibility banner (31-Mar-2019).
- `frontend/admin.html` — relabeled columns, added Court Case Count to table/totals/Excel export/SQL export, Hindi unlock/truncate-demo confirmations.

Remote deploy of the worker code + the two migration files above is the only thing left, whenever you give the go-ahead.

## 6. CUG prefix check, district-name fix, DEO email, leaked contact.csv

- **CUG prefix validation** — ported from `excise-revenue-recovery-portal/frontend/app/login/page.tsx`: all real Excise Dept. CUG mobile numbers start with `94544`. Added a client-side `inputValidator` check in [frontend/index.html](frontend/index.html) (`CUG_PREFIX = '94544'`) before the number is even hashed, so obviously-wrong numbers are rejected before a network round-trip. Hashing (SHA-256 via Web Crypto) and the `/verify-deo` hash-only lookup were already in place from §4.
- **District name fix: `Allahabad` → `Prayagraj`** — the source Excel genuinely lists 59 districts under the old name `Allahabad` (renamed to Prayagraj in 2019), but `contact.csv`/`emails.csv` (and the reference project) use `प्रयागराज` → `Prayagraj`. Renamed in `import.sql`, `schema.sql`-driven local D1, and prepended a rename statement to `api/migrations/003_v2_baseline_reseed.sql` (must run before that file's `Allahabad` UPDATE, which itself is now targeted at `Prayagraj`) so remote gets the same fix when you say go.
- **`deo_email` column** — added (nullable `TEXT`), mirroring the reference project's `users.email`, but scoped to only the 59 districts this repo tracks (not the full 75). Additive migration: [api/migrations/004_deo_email_column.sql](api/migrations/004_deo_email_column.sql) (not yet run on remote).
- **CUG hash + email provisioning data** — real CUG mobile numbers (hashed) and DEO emails, sourced from `scripts_and_data/contact.csv` + `emails.csv`, matched against our 59 districts via the same Hindi→English mapping the reference project uses. Generated into `scripts_and_data/deo_seed.sql` (gitignored — see below) and applied to local D1: all 59 districts now have `cug_hash`/`deo_email` populated (previously **entirely NULL locally**, meaning no DEO could log in on a fresh local setup until now). Not yet run on remote.
- **Security fix: leaked `contact.csv`** — `scripts_and_data/contact.csv` (real officer names + CUG mobile numbers for the whole department) was already committed and pushed to the public GitHub repo. `git rm --cached` on it plus `generated.txt`/`in_db.txt`/`map_cug.py`, and `.gitignore` extended with `scripts_and_data/*.csv`, `*.txt`, `*.py` to match the reference project's gitignore and stop this from recurring. **The old commits still contain it in git history** — that needs a separate history rewrite (not done here) if you want it fully scrubbed, since that's a destructive/force-push operation.

Status: all of the above applied to local D1 only. `api/migrations/004_deo_email_column.sql` and the rename prepended to `003_v2_baseline_reseed.sql` are ready for remote whenever you say go — remote D1 still has `Allahabad`, no `deo_email` column, and no `cug_hash`/DEO login data at all today.
