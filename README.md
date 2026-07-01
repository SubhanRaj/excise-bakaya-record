# UP Excise Bakaya Tracker

A production-grade internal portal built for the Department of Excise, Government of Uttar Pradesh to track and manage dues ("Bakaya") across 59 districts.

## Architecture & Stack

This is a monorepo utilizing a serverless architecture on the Cloudflare ecosystem.

*   **Frontend**: Deployed to Cloudflare Pages. Built with vanilla JavaScript, HTML, CSS, Bootstrap 5, SweetAlert2 (for modals/alerts), Cleave.js (for INR formatting), DataTables, Dexie.js (for caching), and SheetJS (for Excel exports).
    *   `index.html`: The Data Entry Operator (DEO) Portal.
    *   `admin.html`: The Commissioner/Admin Dashboard.
*   **Backend (API)**: Deployed to Cloudflare Workers (`worker.js`).
*   **Database**: Cloudflare D1 (SQLite).

## Database Schema (`excise_dues`)

The `excise_dues` table tracks financial records for the districts:
*   `id` (INTEGER PRIMARY KEY)
*   `district_name` (TEXT)
*   `total_dues` (REAL) - Initial due amount
*   `collected_till_date` (REAL) - Recovered till a specific date
*   `collected_after_date` (REAL) - Input by DEO
*   `batte_khatte_count` (INTEGER) - Input by DEO
*   `batte_khatte_amount` (REAL) - Input by DEO
*   `court_stayed_amount` (REAL) - Input by DEO
*   `is_locked` (INTEGER DEFAULT 0) - Locks form after submission
*   `deo_name` (TEXT) - Captured via SweetAlert during submission
*   `locked_at` (DATETIME) - Timestamp of submission
*   `last_updated` (DATETIME)
*   `cug_hash` (TEXT) - Stores SHA-256 hash of the 10-digit CUG number (For verification)

## Features

### DEO Portal (`index.html`)
*   **CUG Authentication**: Initial screen is blurred until the DEO enters their valid 10-digit CUG number. Verification is done via SHA-256 hashing.
*   **Session State**: Uses `localStorage` to remember successful CUG logins and automatically select and disable the corresponding district dropdown.
*   **Form Locking**: Checks `is_locked` from DB and `localStorage` to prevent duplicate submissions on the same device.
*   **Client-side Calculations**: Automatically computes "Total Dues Left" and "Net Recoverable Amount".
*   **Secure Submission**: Triggers SweetAlert2 for DEO name and sends POST to the API.

### Admin Dashboard (`admin.html`)
*   **Authentication**: PIN-protected access (verified against Cloudflare secret `env.ADMIN_PIN`). Uses `sessionStorage` to persist login during the session, with a convenient Logout button.
*   **Offline Caching**: Uses IndexedDB (via Dexie.js) to instantly load the 59 districts upon revisit, drastically reducing database load.
*   **Manual Sync**: A manual "Sync" button is available to fetch fresh data from the server, alongside a "Last Sync" timestamp.
*   **Data Export**: 
    *   **Excel (.xlsx)**: Utilizes SheetJS to generate heavily formatted Excel reports natively on the client device.
    *   **SQL Backup (.sql)**: Generates a raw `.sql` file with `UPDATE` statements for the entire dataset.
*   **Grid Management**: DataTables grid displaying all districts with sorting, filtering, and a sticky header. Includes an "Unlock" feature to reset the `is_locked` status for specific DEOs.

## API Endpoints (`worker.js`)
*   `GET /`: Returns all district records.
*   `POST /`: Updates financial columns, locks the record, and logs timestamps/DEO name.
*   `POST /auth`: Authenticates the Admin page PIN.
*   `POST /unlock`: Resets a district's lock status.
*   `POST /verify-deo`: Verifies the DEO's CUG number hash.

## Setup and Deployment

**Note**: Raw CSV data and utility mapping scripts are stored in the local `scripts_and_data/` folder and ignored via `.gitignore` to keep the repository clean.

1. Initialize database (Local Testing):
   ```bash
   npx wrangler d1 execute excise-bakaya-db --local --file=./api/schema.sql
   npx wrangler d1 execute excise-bakaya-db --local --file=./api/import.sql
   ```
2. Start local worker:
   ```bash
   cd api && npm run dev
   ```
3. Start frontend:
   Serve the `/frontend` directory using any local web server (e.g. `npx serve frontend`).
