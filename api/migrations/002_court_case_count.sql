-- Additive-only, safe to run on remote/live D1 without data loss.
-- Adds Court Case Count alongside the existing Court Stayed Amount, mirroring Batte Khatte.
ALTER TABLE excise_dues ADD COLUMN court_case_count INTEGER DEFAULT 0;
