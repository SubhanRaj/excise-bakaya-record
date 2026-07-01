DROP TABLE IF EXISTS excise_dues;
CREATE TABLE excise_dues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    district_name TEXT NOT NULL,
    total_dues REAL NOT NULL,
    collected_till_pac REAL NOT NULL,
    collected_after_pac REAL DEFAULT 0,
    batte_khatte REAL DEFAULT 0,
    hc_stayed REAL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
