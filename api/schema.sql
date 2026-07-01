DROP TABLE IF EXISTS excise_dues;
CREATE TABLE excise_dues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    district_name TEXT NOT NULL,
    total_dues REAL NOT NULL,
    collected_till_date REAL NOT NULL,
    collected_after_date REAL DEFAULT 0,
    batte_khatte_count INTEGER DEFAULT 0,
    batte_khatte_amount REAL DEFAULT 0,
    court_stayed_amount REAL DEFAULT 0,
    is_locked INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Re-insert test data
INSERT INTO excise_dues (district_name, total_dues, collected_till_date) VALUES 
('Lucknow', 50000000, 15000000),
('Kanpur Nagar', 45000000, 20000000),
('Agra', 30000000, 10000000);