# UP Excise Bakaya Tracker

A production-grade internal portal built for the Department of Excise, Government of Uttar Pradesh to track and manage dues ("Bakaya") across 59 districts.

## Architecture & Stack

This is a monorepo utilizing a serverless architecture on the Cloudflare ecosystem.

*   **Frontend**: Deployed to Cloudflare Pages. Built with vanilla JavaScript, HTML, CSS, Bootstrap 5, SweetAlert2 (for modals/alerts), Cleave.js (for INR formatting), and DataTables.
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
*   Select district from a dropdown.
*   Form locking mechanism: Checks `is_locked` from DB and `localStorage` to prevent duplicate submissions.
*   Client-side calculations for "Total Dues Left" and "Net Recoverable Amount".
*   Secure submission: Triggers SweetAlert2 for DEO name and sends POST to the API.

### Admin Dashboard (`admin.html`)
*   PIN-protected access (verified against `env.ADMIN_PIN`).
*   DataTables grid displaying all 59 districts with sorting/filtering and a sticky header.
*   Unlock functionality to allow DEOs to re-submit data for specific locked districts.

## API Endpoints (`worker.js`)
*   `GET /`: Returns all district records.
*   `POST /`: Updates financial columns, locks the record, and logs timestamps/DEO name.
*   `POST /auth`: Authenticates the Admin page PIN.
*   `POST /unlock`: Resets a district's lock status.
*   `POST /verify-deo` *(Planned)*: Verifies the DEO's CUG number hash.

## Setup and Deployment

1. Initialize database:
   ```bash
   npx wrangler d1 execute excise-bakaya-db --local --file=./api/schema.sql
   npx wrangler d1 execute excise-bakaya-db --local --file=./api/import.sql
   ```
2. Start local worker:
   ```bash
   cd api && npm run dev
   ```
3. Start frontend:
   Serve the `/frontend` directory using any local web server.
