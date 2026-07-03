# UP Excise Bakaya Tracker

A production-grade internal portal built for the Department of Excise, Government of Uttar Pradesh to track and manage dues ("Bakaya") across 59 districts.

## Architecture & Stack

This is a monorepo utilizing a serverless architecture on the Cloudflare ecosystem.

*   **Frontend**: Deployed to Cloudflare Pages. Built with vanilla JavaScript, HTML, CSS, Bootstrap 5, SweetAlert2 (for modals/alerts), Cleave.js (for INR formatting), DataTables, Dexie.js (for caching), SheetJS (for Excel exports), and Tabler Icons (for UI iconography).
    *   `index.html`: The Data Entry Operator (DEO) Portal.
    *   `admin.html`: The Commissioner/Admin Dashboard.
*   **Backend (API)**: Deployed to Cloudflare Workers (`worker.js`).
*   **Database**: Cloudflare D1 (SQLite).

## Database Schema & Data Fields

The `excise_dues` table tracks financial records for the districts. The system captures specific financial indicators natively in Hindi to assist the local DEOs.

### Schema Fields & Corresponding Hindi UI Labels:
*   `id` (INTEGER PRIMARY KEY) - Unique identifier for the record.
*   `district_name` (TEXT) - Name of the district.
*   `total_dues` (REAL) - **"2. वसूल की जाने वाली सकल धनराशि"** (Initial Total Dues - Read Only).
*   `collected_till_date` (REAL) - **"3. 13-November-2025 तक वसूल की गई धनराशि"** (Recovered till a specific date - Read Only).
*   `collected_after_date` (REAL) - **"4. 13-November-2025 के उपरांत वसूल की गई धनराशि"** (Input by DEO).
*   **"5. कुल बकाया धनराशि"** (Total Dues Left) - Auto-calculated client-side: `total_dues - collected_till_date - collected_after_date`.
*   `batte_khatte_count` (INTEGER) - **"6. आयुक्तालय को प्रेषित बट्टे खाते में डाले जाने वाले प्रकरणों की संख्या..."** (Count Input by DEO).
*   `batte_khatte_amount` (REAL) - **"...एवं उसमें निहित धनराशि"** (Amount Input by DEO).
*   `court_stayed_amount` (REAL) - **"7. सक्षम न्यायालय द्वारा स्थगित प्रकरणों में निहित धनराशि"** (Input by DEO).
*   **"8. शुद्ध वसूल की जाने वाली धनराशि"** (Net Recoverable Amount) - Auto-calculated client-side: `Total Dues Left - batte_khatte_amount - court_stayed_amount`.
*   `is_locked` (INTEGER DEFAULT 0) - Boolean flag that locks the form after a successful submission.
*   `deo_name` (TEXT) - Captured via a SweetAlert prompt exactly at the time of locking.
*   `locked_at` (DATETIME) - Timestamp of submission.
*   `last_updated` (DATETIME) - Timestamp of any modification.
*   `cug_hash` (TEXT) - Stores the SHA-256 hash of the DEO's 10-digit CUG (Closed User Group) mobile number.

## Comprehensive Feature List

### DEO Portal (`index.html`)

*   **CUG Authentication & Verification**: The initial screen is blurred out, preventing access until the DEO enters their authorized 10-digit CUG number. The frontend sends this number to the backend `verify-deo` endpoint, where it is hashed using SHA-256 and compared against the stored `cug_hash` in the database. 
*   **Session State & Auto-Selection**: Upon successful CUG verification, the system uses `localStorage` to remember the login. It automatically selects the DEO's corresponding district from the dropdown and disables it, ensuring they can only enter data for their authorized district. A secure logout feature clears this session.
*   **Form Locking & DEO Name Capture**: To prevent duplicate or unauthorized overwrites, the system employs a rigid locking mechanism. Once the DEO fills the form and clicks submit, a mandatory SweetAlert2 prompt requires them to type their exact Name ("जिला आबकारी अधिकारी का नाम दर्ज करें"). The submission is sent to the backend, the `is_locked` flag is set to `1` in the DB, and the `deo_name` is stored. Locally, a `locked_district_{id}` flag is saved to `localStorage`. If `is_locked` is true, the form is completely hidden, and a locked warning is displayed.
*   **Real-time Client-side Calculations**: Financial fields like "Total Dues Left" and "Net Recoverable Amount" are calculated reactively in JavaScript as the user types. Input formatting (commas for Lakhs/Crores) is strictly enforced using Cleave.js, ensuring Indian Numeral formatting (₹). The submit button is automatically disabled if input amounts exceed logical mathematical limits.

### Admin Dashboard (`admin.html`)

*   **Authentication**: Secure PIN-protected access verified against the Cloudflare secret `env.ADMIN_PIN`. It uses `sessionStorage` to persist login during the active browser session, featuring a secure Logout button (Tabler icon).
*   **Offline Caching for Performance**: The dashboard utilizes IndexedDB (via Dexie.js) to instantly load the 59 districts upon revisit. This drastically reduces read queries on the Cloudflare D1 database and provides an instant load experience.
*   **Manual Sync**: A manual "Sync" button fetches fresh, bypassing the Dexie cache, paired with a dynamic "Last Sync" timestamp.
*   **Data Export**: 
    *   **Excel (.xlsx)**: Utilizes SheetJS to generate heavily formatted Excel reports natively on the client device.
    *   **SQL Backup (.sql)**: Generates a raw `.sql` file with `UPDATE` statements for the entire dataset.
*   **Lock/Unlock Mechanism**: Administrators have the exclusive ability to override the DEO lock. An "Unlock" button is available in the DataTable for each locked row. Clicking it resets the `is_locked` status to `0` in the database, allowing the DEO to resubmit if they made an error.
*   **Premium Grid UI**: A high-performance DataTables grid displays all districts with advanced typography, soft shadow hover animations, and a styled sticky header. All financial columns are prepended with the Indian Rupee symbol (₹).

## API Endpoints (`worker.js`)

**Security**: All endpoints strictly require an `X-API-Secret` header matching the `API_SECRET` Wrangler environment variable to prevent unauthenticated access or bot scraping.

*   `GET /`: Returns all district records.
*   `POST /`: Updates financial columns, locks the record, and logs timestamps/DEO name.
*   `POST /auth`: Authenticates the Admin page PIN.
*   `POST /unlock`: Resets a district's lock status (`is_locked = 0`).
*   `POST /verify-deo`: Verifies the DEO's CUG number hash by comparing the SHA-256 hash of the payload against the stored `cug_hash`.

## Scripts and Data Processing (`scripts_and_data/`)

We have included data processing scripts and formatted data within the repository to streamline future updates, while carefully keeping sensitive files out of version control.

*   **`contact.csv`**: Contains the raw contact directory data including CUG numbers of District Excise Officers in Hindi.
*   **`map_cug.py`**: A Python utility script that reads `contact.csv`, maps the Hindi district names to their English equivalents (matching the `import.sql` data), extracts the valid 10-digit CUG numbers, hashes them using SHA-256, and generates an `update_cug.sql` file. This automated process ensures CUG numbers are securely loaded without manually inputting them.
*   **Security Note**: All raw SQL files (`*.sql`) and hash files are excluded from version control via `.gitignore` to maintain data security and prevent leakage of sensitive database queries or PII hashes.

## Setup and Deployment

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
