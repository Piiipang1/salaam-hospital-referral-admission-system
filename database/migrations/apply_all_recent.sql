-- =============================================================================
-- Consolidated schema migrations from the recent update batch.
-- Run this ONCE against the production database the deployed backend uses.
-- All four are safe on populated tables (existing rows get the DEFAULT / keep
-- their current status value).
--
-- If your production database is NOT named salaam_hospital, change the USE line.
-- If a statement errors with "Duplicate column name" it is already applied —
-- skip that one and continue with the rest.
-- =============================================================================

USE salaam_hospital;

-- 1. doctors.is_er_assigned  — THIS is the column whose absence causes the
--    "Server error." on doctor login. Only ER-assigned doctors may admit.
ALTER TABLE doctors
  ADD COLUMN is_er_assigned TINYINT(1) NOT NULL DEFAULT 0 AFTER specialization;

-- 2. users.is_doctor_in_charge  — Doctor-in-Charge (DIC) mode flag.
ALTER TABLE users
  ADD COLUMN is_doctor_in_charge TINYINT(1) NOT NULL DEFAULT 0 AFTER linked_id;

-- 3. admissions.status  — add the 'Pending Discharge' enum value (two-step discharge).
ALTER TABLE admissions MODIFY COLUMN status
  ENUM('Pending Room','Active','Pending Discharge','Discharged')
  NOT NULL DEFAULT 'Pending Room';

-- 4. vital_signs.updated_at  — tracks last edit; recorded_at stays the creation time.
ALTER TABLE vital_signs
  ADD COLUMN updated_at DATETIME NULL DEFAULT NULL AFTER recorded_at;

-- 5. referrals.file_attachment  — optional referral form document (multer
--    filename in backend/uploads/). createReferral INSERTs this column;
--    without it every referral creation fails with "Unknown column".
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS file_attachment VARCHAR(255) DEFAULT NULL
    COMMENT 'filename saved in backend/uploads/'
    AFTER e_signature;
