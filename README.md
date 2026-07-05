# UP Excise Bakaya Tracker

A production-grade internal portal built for the Department of Excise, Government of Uttar Pradesh to track and manage dues ("Bakaya") across 59 districts.

## Tech Stack & Libraries

This is a monorepo utilizing a serverless architecture, carefully designed to operate with zero traditional server maintenance while delivering a high-performance experience.

### Frontend (Client-Side)
Deployed statically via **Cloudflare Pages**. No build steps (like Webpack/Vite) were used to maintain extreme simplicity and fast execution.
*   **Vanilla HTML5 / CSS3 / JavaScript**: The core foundation.
*   **Bootstrap 5 (CDN)**: Provides the responsive grid layout, card structures, and base styling.
*   **SweetAlert2**: Replaces all native browser prompts with beautiful, non-dismissible custom modals used for CUG Authentication, Admin PIN verification, and form locking signatures.
*   **Cleave.js**: Handles real-time input formatting as the user types, specifically configured for the Indian Numeral System (Lakhs/Crores) to enforce accurate financial data entry.
*   **DataTables & jQuery**: Powers the Admin Dashboard's grid UI, enabling instant searching, sorting, pagination, and sticky headers/footers for large datasets.
*   **Dexie.js**: A minimalistic wrapper for IndexedDB, utilized exclusively on the Admin Dashboard to cache all 59 districts offline, ensuring instant page loads upon revisiting.
*   **SheetJS (xlsx)**: An advanced spreadsheet library used to natively generate `.xlsx` backup files in the browser, complete with custom cell colors, frozen rows, and dynamic currency formatting.
*   **Tabler Icons**: Lightweight SVG webfont used for clear UI iconography (Export, Sync, Logout).

### Backend (API)
Deployed to the edge via **Cloudflare Workers**. 
*   **Cloudflare Workers**: The serverless execution environment routing all API traffic (`worker.js`).
*   **Cloudflare D1**: A serverless, globally distributed SQLite database engine (`schema.sql`).
*   **Web Crypto API (`crypto.subtle`)**: A native edge-compatible cryptography API utilized to perform SHA-256 hashing of the CUG mobile numbers without needing heavy external Node.js dependencies.
*   **Wrangler**: Cloudflare's CLI tool used for local database execution, secret management, and deployments.

### Data Processing Utilities
*   **Python 3**: Used for offline data mapping (`map_cug.py`). Utilizes standard libraries (`csv`, `hashlib`, `json`) to translate Hindi district names to English and pre-hash CUG numbers into `update_cug.sql` scripts.

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

## Mathematical Calculation Logic

To minimize database load and ensure instantaneous user feedback, all financial calculations are performed **reactively on the client-side** (in both `index.html` and `admin.html`), utilizing the exact same formulas:

1.  **Total Dues Left (कुल बकाया धनराशि)**:
    *   **Formula**: `Total Dues` - `Collected Till Date` - `Collected After Date (Input)`
    *   This represents the gross remaining dues before applying any special deductions.
2.  **Net Recoverable Amount (शुद्ध वसूल की जाने वाली धनराशि)**:
    *   **Formula**: `Total Dues Left` - `Batte Khatte Amount (Input)` - `Court Stayed Amount (Input)`
    *   **Floor Constraint**: The UI enforces a floor limit using `Math.max(0, value)` so that the net recoverable amount can never display as a negative number.
3.  **Logical Submit Validation**:
    *   To prevent mathematical impossibilities from being entered into the database, the DEO Portal physically disables the "Verify & Lock Record" button if:
        *   `Batte Khatte Amount > Total Dues Left` (Cannot deduct more than what remains).
        *   `Court Stayed Amount > (Total Dues Left - Batte Khatte Amount)` (Cannot stay more than the remainder).

## Comprehensive Feature List

### DEO Portal (`index.html`)

*   **1. Zero-Trust CUG Authentication**: The initial screen is completely blurred (`filter: blur(8px);`), preventing any interaction. The DEO is prompted via a non-dismissible SweetAlert2 modal to enter their authorized 10-digit CUG mobile number. The frontend sends this to the `verify-deo` worker endpoint, which hashes it using SHA-256 and compares it against the `cug_hash` in the D1 database.
*   **2. Persistent Session & Hard-Coded Auto-Selection**: Upon successful CUG verification, the system stores `cug_verified_district_id` in `localStorage`. The page unblurs, automatically selects the DEO's specific district from the dropdown, and explicitly disables the dropdown (`disabled = true`). This physically prevents a DEO from submitting data for any other district. A secure Logout button is provided to clear this session.
*   **3. The Locking Lifecycle (DEO Side)**: 
    *   **Pre-Submit Check**: Before the form even renders, the system checks the `is_locked` database flag and a local `locked_district_{id}` flag. If locked, the form is entirely hidden and replaced with a yellow warning alert.
    *   **The Lock Action**: When the DEO clicks submit, a mandatory SweetAlert2 prompt requires them to manually type their exact Name ("जिला आबकारी अधिकारी का नाम दर्ज करें"). This acts as a digital signature.
    *   **Database Commit**: The frontend payload (financials + DEO Name) is sent to the API. The API updates the record, records the `locked_at` timestamp, stores the `deo_name`, and decisively flips `is_locked` to `1`.
    *   **Post-Lock State**: Upon a `200 OK` response, the form instantly disappears from the UI and is replaced by the locked warning, preventing any double-submissions or tampering.
*   **4. Real-time Client-side Calculations**: Financial fields like "Total Dues Left" and "Net Recoverable Amount" are calculated reactively in JavaScript as the user types. Input formatting is strictly enforced using Cleave.js, ensuring Indian Numeral formatting (₹). The submit button is automatically disabled if input amounts exceed logical mathematical limits.

### Admin Dashboard (`admin.html`)

*   **1. Secure Admin Authentication**: Access is strictly PIN-protected via a non-dismissible SweetAlert2 prompt. The entered PIN is verified against the backend Cloudflare Wrangler Secret `env.ADMIN_PIN`. Upon success, `sessionStorage` (not localStorage) is used to persist the login, ensuring the admin session is automatically destroyed when the browser tab is closed.
*   **2. The Locking Lifecycle (Admin Side - Override)**: 
    *   Administrators have the exclusive, ultimate authority to override the DEO lock. 
    *   In the Admin DataTable, every locked district row displays a red "Locked" badge accompanied by an "Unlock" button.
    *   Clicking "Unlock" triggers a confirmation modal. If confirmed, a request is sent to the `/unlock` API endpoint.
    *   The API resets `is_locked` to `0` in the database. The Admin dashboard automatically triggers a silent background sync (`syncData(false)`) to refresh the UI, and the DEO can instantly see the form again on their portal to resubmit data.
*   **3. Offline Caching for Performance**: The dashboard utilizes IndexedDB (via Dexie.js) to instantly load the 59 districts upon revisit. This drastically reduces read queries on the Cloudflare D1 database and provides an instant load experience.
*   **4. Manual Sync**: A manual "Sync" button fetches fresh data, bypassing the Dexie cache, paired with a dynamic "Last Sync" timestamp.
*   **5. Data Export & Reporting**:
    *   **Excel (.xlsx) Generation**: Utilizes SheetJS to generate highly formatted Excel reports natively on the client device. 
        *   **Auto-Sync**: Triggering an Excel export automatically initiates a silent background sync with the Cloudflare D1 database (`syncData(false)`), ensuring the downloaded report always contains the absolute most up-to-date information, bypassing the local Dexie cache.
        *   **Advanced Formatting**: The generated Excel file features a custom header with the exact Date and Time of generation (e.g., "Excise Bakaya District Wise Summary as on 13-Nov-2025, 14:30 PM").
        *   **Row & Column Freezing**: The top 3 header rows and the first column (District Name) are frozen (`!views: { state: 'frozen', xSplit: 0, ySplit: 3 }`), allowing administrators to scroll through large datasets while keeping context visible.
        *   **Automated Totals**: A dynamic "TOTAL (59 Districts)" row is appended at the very bottom, summing up all financial columns. It is visually distinguished with a subtle green background (`#D4EDDA`).
        *   **Currency Formatting**: All financial columns in the Excel sheet are natively formatted as Indian Rupees (`"₹"#,##0.00`) so they appear correctly when opened in Microsoft Excel.
    *   **SQL Backup (.sql)**: Generates a raw `.sql` file with `UPDATE` statements for the entire dataset, timestamped for archival purposes.
*   **6. Demo Mode Management**: The dashboard includes a "Truncate Demo" button explicitly designed to delete demo data. This action triggers an API endpoint that is securely hardcoded to target only the "Demo District". This provides a one-click, risk-free cleanup mechanism for administrators to permanently remove demo data before the portal goes live, guaranteeing that no real district can ever be truncated.
*   **Premium Grid UI (DataTables)**: 
    *   **Sticky & Frozen Elements**: The table features a sticky top header (`position: sticky`) and a frozen first column (`left: 0`) with proper z-indexing, ensuring the District Name and column titles are always visible during vertical and horizontal scrolling.
    *   **Dynamic Totals Footer**: The table includes a frozen footer (`tfoot`) that automatically sums up Gross Dues, Recovered Amounts, Batte Khatte, Court Stayed, and Net Recoverable Targets across all loaded districts, matching the Excel export logic.
    *   **Aesthetics**: A high-performance DataTables grid displaying all districts with advanced typography (Inter/Segoe UI), soft shadow hover animations (`transform: scale(1.002)`). All financial columns are dynamically prepended with the Indian Rupee symbol (₹) using JavaScript formatters.

## API Endpoints (`worker.js`)

**Security & DDoS Protection**: All endpoints strictly require an `X-API-Secret` header matching the `API_SECRET` Wrangler environment variable to prevent unauthenticated access or bot scraping. Furthermore, the Worker implements robust defenses:
*   **In-Memory Rate Limiting**: The worker maintains a sliding window `Map` tracking the `cf-connecting-ip`. It limits traffic to 60 requests per minute per IP to prevent brute-force attacks and database spam, returning HTTP 429 (Too Many Requests).
*   **Memory Leak Prevention**: Under severe DDoS conditions, if the rate-limiting map exceeds 5000 unique IP entries, it aggressively auto-clears to prevent V8 memory exhaustion.
*   **CORS Management**: Explicitly handles HTTP `OPTIONS` preflight requests allowing cross-origin resource sharing from the frontend domain.
*   **Native Cryptography**: Utilizes the native Cloudflare `crypto.subtle.digest` (Web Crypto API) to perform SHA-256 hashing at the edge without external dependencies.

**Routes**:
*   `GET /`: Returns all 59 district records for table rendering.
*   `POST /`: Updates financial columns, locks the record, and logs timestamps/DEO name.
*   `POST /auth`: Authenticates the Admin page PIN.
*   `POST /unlock`: Resets a district's lock status (`is_locked = 0`).
*   `POST /truncate-demo`: Permanently deletes the "Demo District" row from the database. This query strictly enforces `WHERE district_name = 'Demo District'` at the edge, ensuring it is physically impossible to truncate real districts.
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
