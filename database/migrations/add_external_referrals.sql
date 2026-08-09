-- =============================================================================
-- External referrals — refer a patient to an OUTSIDE hospital when this
-- facility is at capacity (no available beds).
--
-- Why the existing table could not express this:
--   * assigned_doctor_id was NOT NULL + FK to doctors — an external destination
--     has no doctor in OUR system, so it must become nullable.
--   * diagnosis_id was NOT NULL, and every referral query resolved the patient
--     by joining referrals -> diagnoses -> patients. A patient turned away at
--     intake often has no diagnosis yet, so referrals now carry patient_id
--     directly and diagnosis_id becomes optional.
--
-- Safe on populated tables: every new column is nullable or has a DEFAULT, and
-- the backfill fills patient_id for all pre-existing rows from their diagnosis.
-- Idempotent on MariaDB 10.0.2+ (IF NOT EXISTS on columns/keys/indexes).
--
-- If your database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

-- 1. New columns -------------------------------------------------------------
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS patient_id INT UNSIGNED NULL
    COMMENT 'Direct patient link. Required for external referrals, which may have no diagnosis.'
    AFTER diagnosis_id,
  ADD COLUMN IF NOT EXISTS is_external TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = referred OUT to a hospital outside this system'
    AFTER status,
  ADD COLUMN IF NOT EXISTS external_hospital_name VARCHAR(200) DEFAULT NULL
    AFTER is_external,
  ADD COLUMN IF NOT EXISTS external_hospital_contact VARCHAR(50) DEFAULT NULL
    AFTER external_hospital_name,
  ADD COLUMN IF NOT EXISTS external_hospital_address VARCHAR(255) DEFAULT NULL
    AFTER external_hospital_contact,
  ADD COLUMN IF NOT EXISTS external_reason TEXT DEFAULT NULL
    COMMENT 'Why the patient was diverted (e.g. no available beds)'
    AFTER external_hospital_address,
  ADD COLUMN IF NOT EXISTS created_by INT UNSIGNED NULL
    COMMENT 'users.user_id who recorded it — nurses/staff may create external referrals and are not doctors'
    AFTER external_reason;

-- 2. Relax the two NOT NULLs that assumed an internal referral ----------------
-- An external referral has no assigned doctor in this system, and may predate
-- any diagnosis. Existing rows are unaffected (they keep their values).
ALTER TABLE referrals MODIFY COLUMN diagnosis_id       INT UNSIGNED NULL;
ALTER TABLE referrals MODIFY COLUMN assigned_doctor_id INT UNSIGNED NULL;

-- 3. Backfill patient_id for every pre-existing referral ----------------------
-- After this, patient_id is populated for all rows and new code can rely on
-- COALESCE(r.patient_id, diag.patient_id) resolving for both old and new rows.
UPDATE referrals r
  JOIN diagnoses d ON d.diagnosis_id = r.diagnosis_id
  SET r.patient_id = d.patient_id
  WHERE r.patient_id IS NULL;

-- 4. Foreign keys ------------------------------------------------------------
-- patient CASCADE matches fk_referrals_diagnosis (deleting a patient already
-- cascaded to their diagnoses and through to referrals).
-- created_by SET NULL matches fk_admissions_discharge_confirmed_by — deleting a
-- user account must never delete the clinical record they wrote.
-- NOTE: MariaDB places IF NOT EXISTS AFTER the FOREIGN KEY keyword, not after
-- the constraint name (ADD CONSTRAINT x FOREIGN KEY IF NOT EXISTS (...)).
ALTER TABLE referrals
  ADD CONSTRAINT fk_referrals_patient
    FOREIGN KEY IF NOT EXISTS (patient_id) REFERENCES patients (patient_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT fk_referrals_created_by
    FOREIGN KEY IF NOT EXISTS (created_by) REFERENCES users (user_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- 5. Indexes -----------------------------------------------------------------
-- patient_id: getReferralHistory and getPatientHistory filter on it.
-- is_external: the Referrals page filters internal vs external.
CREATE INDEX IF NOT EXISTS idx_referrals_patient  ON referrals (patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_external ON referrals (is_external);
