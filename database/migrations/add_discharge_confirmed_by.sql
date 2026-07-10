-- Track which nurse confirmed each discharge (two-step discharge, step 2).
-- Nullable FK to users; ON DELETE SET NULL keeps the admission record if the
-- confirming user account is later removed.

USE salaam_hospital;

ALTER TABLE admissions
  ADD COLUMN discharge_confirmed_by INT UNSIGNED NULL DEFAULT NULL AFTER discharge_notes,
  ADD CONSTRAINT fk_admissions_discharge_confirmed_by
    FOREIGN KEY (discharge_confirmed_by) REFERENCES users (user_id) ON DELETE SET NULL;
