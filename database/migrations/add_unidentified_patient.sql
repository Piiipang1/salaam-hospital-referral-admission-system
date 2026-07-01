ALTER TABLE patients ADD COLUMN is_unidentified TINYINT(1) NOT NULL DEFAULT 0 AFTER emergency_contact_number;
