-- =============================================================================
-- Referral remarks + specialty-based referral rules
--
-- 1. referrals.remarks — why this patient is being handed to another doctor.
--    Mandatory for NEW internal referrals (enforced in referrals.controller);
--    the column is NULLable because referrals created before this rule existed
--    genuinely have no remarks, and inventing text for them would be worse than
--    leaving them blank.
--
-- 2. Specialty coverage — a referral is only valid when the receiving doctor
--    can treat something the referring doctor cannot, which is decided by
--    comparing specializations. That rule is only useful if the specialties
--    actually differ, so this ensures the two headline specialties exist with
--    working logins: Cardiology (heart) and Ophthalmology (eye).
--
-- Safe on populated tables: one nullable column, and inserts guarded so
-- re-running cannot create duplicate doctors or accounts.
-- If your database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

-- 1. Remarks ------------------------------------------------------------------
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT NULL
    COMMENT 'Why the patient is being referred — required for new internal referrals'
    AFTER status;

-- 2. Headline specialties -----------------------------------------------------
-- Cardiology already exists in most installs; Ophthalmology typically does not.
-- INSERT ... SELECT ... WHERE NOT EXISTS makes both idempotent.
INSERT INTO doctors (first_name, last_name, specialization, contact_details, employment_status)
SELECT 'Nur-Aina', 'Balindong', 'Cardiology', '09171000101', 'Active'
WHERE NOT EXISTS (
  SELECT 1 FROM doctors WHERE specialization = 'Cardiology' AND employment_status = 'Active'
);

INSERT INTO doctors (first_name, last_name, specialization, contact_details, employment_status)
SELECT 'Yusuf', 'Macapaar', 'Ophthalmology', '09171000102', 'Active'
WHERE NOT EXISTS (
  SELECT 1 FROM doctors WHERE specialization = 'Ophthalmology' AND employment_status = 'Active'
);

-- 3. Logins for the headline specialists --------------------------------------
-- A specialist nobody can sign in as cannot accept a referral, which would make
-- the specialty rule unusable in practice. Passwords are the project's standard
-- seed hash (plaintext: doctor123) — change them before any real deployment.
--
-- Guarded on the DOCTOR, not just the username: where the specialist already
-- has a login (a stock install ships a Cardiologist as doctor7), adding a second
-- account for the same person would split their referrals across two identities.
INSERT INTO users (username, password_hash, role, linked_id, is_active)
SELECT 'doctor.cardio',
       '$2b$10$QHnXJlX52blgSMQdJzZOLOTCr0EfPZFqd9vCJ3OEAEjI0v/3/b922',
       'doctor', d.doctor_id, 1
FROM doctors d
WHERE d.specialization = 'Cardiology' AND d.employment_status = 'Active'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.role = 'doctor' AND u.linked_id = d.doctor_id)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.username = 'doctor.cardio')
ORDER BY d.doctor_id LIMIT 1;

INSERT INTO users (username, password_hash, role, linked_id, is_active)
SELECT 'doctor.eye',
       '$2b$10$QHnXJlX52blgSMQdJzZOLOTCr0EfPZFqd9vCJ3OEAEjI0v/3/b922',
       'doctor', d.doctor_id, 1
FROM doctors d
WHERE d.specialization = 'Ophthalmology' AND d.employment_status = 'Active'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.role = 'doctor' AND u.linked_id = d.doctor_id)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.username = 'doctor.eye')
ORDER BY d.doctor_id LIMIT 1;
