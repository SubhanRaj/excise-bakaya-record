DROP TABLE IF EXISTS excise_dues;
CREATE TABLE excise_dues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    district_name TEXT NOT NULL,
    total_dues REAL NOT NULL,
    collected_till_date REAL NOT NULL DEFAULT 0,
    collected_after_date REAL DEFAULT 0,
    batte_khatte_count INTEGER DEFAULT 0,
    batte_khatte_amount REAL DEFAULT 0,
    court_case_count INTEGER DEFAULT 0,
    court_stayed_amount REAL DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    deo_name TEXT,
    deo_email TEXT,
    cug_hash TEXT,
    locked_at DATETIME,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_excise_dues_cug_hash ON excise_dues(cug_hash);
