-- Additive-only, safe to run on remote/live D1 without data loss.
-- Reference column for the DEO's registered email (provisioning data), mirroring the
-- excise-revenue-recovery-portal's users.email. Not entered by the DEO themselves.
ALTER TABLE excise_dues ADD COLUMN deo_email TEXT;
