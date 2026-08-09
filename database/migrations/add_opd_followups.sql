-- =============================================================================
-- Automatic OPD follow-up routing on discharge
--
-- Every discharged inpatient leaves with a scheduled outpatient follow-up. The
-- discharge cannot be confirmed without one (admissions.controller
-- confirmDischarge), and the record is created in the SAME transaction as the
-- discharge — so "discharged with no follow-up booked" is not a state this
-- database can hold.
--
-- Two tables:
--   opd_clinics   — the outpatient clinics a follow-up can be routed to. Each
--                   carries the doctors.specialization string it corresponds to,
--                   which is what makes automatic routing possible.
--   opd_followups — the follow-up itself: an Outpatient visit linked back to the
--                   patient, the admission that generated it, and the clinical
--                   thread (diagnosis) it continues.
--
-- Automatic classification (see utils/opdRouting.js) resolves the clinic by:
--   1. the attending doctor's specialization matching opd_clinics.specialization
--   2. failing that, the admission_type (Surgical → Surgery, Pediatric →
--      Pediatrics, Maternity → OB-GYN, …)
--   3. failing that, the default clinic (is_default = 1)
-- The nurse may override the choice; classified_by records which happened, so
-- "how often is the automatic routing wrong?" stays an answerable question.
--
-- Safe on populated tables: two new tables, no column changes to existing ones.
-- If your database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

-- 1. Clinics ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opd_clinics (
    clinic_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name           VARCHAR(120) NOT NULL,
    specialization VARCHAR(150) NULL
                   COMMENT 'Matches doctors.specialization — the key automatic routing uses',
    description    VARCHAR(255) NULL,
    is_default     TINYINT(1)   NOT NULL DEFAULT 0
                   COMMENT '1 = catch-all when nothing else matches; exactly one row should have this',
    is_active      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (clinic_id),
    UNIQUE KEY uq_opd_clinic_name (name),
    KEY idx_opd_clinic_specialization (specialization)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seeded to mirror the specializations the doctors table actually uses, so
-- specialization-based routing resolves on day one. General Medicine is the
-- catch-all.
INSERT IGNORE INTO opd_clinics (name, specialization, description, is_default) VALUES
('General Medicine Clinic',    'General Medicine',           'General adult follow-up and post-discharge review', 1),
('Internal Medicine Clinic',   'Internal Medicine',          'Chronic and complex medical follow-up',             0),
('Surgery Clinic',             'Surgery',                    'Post-operative review and wound care',              0),
('Pediatrics Clinic',          'Pediatrics',                 'Follow-up for patients under 18',                   0),
('OB-GYN Clinic',              'Obstetrics and Gynecology',  'Maternity and gynaecological follow-up',            0),
('Cardiology Clinic',          'Cardiology',                 'Cardiac follow-up',                                 0),
('Orthopedics Clinic',         'Orthopedics',                'Fracture, joint and mobility follow-up',            0),
('Family Medicine Clinic',     'Family Medicine',            'Primary-care follow-up',                            0),
('Pulmonology Clinic',         'Pulmonology',                'Respiratory follow-up',                             0),
('Nephrology Clinic',          'Nephrology',                 'Renal follow-up',                                   0),
('Neurology Clinic',           'Neurology',                  'Neurological follow-up',                            0),
('Infectious Disease Clinic',  'Infectious Disease',         'Infection and communicable disease follow-up',      0),
('Gastroenterology Clinic',    'Gastroenterology',           'Digestive system follow-up',                        0),
('Emergency Medicine Clinic',  'Emergency Medicine',         'Short-interval review after an emergency episode',  0);

-- 2. Follow-ups ---------------------------------------------------------------
-- visit_type is fixed to 'Outpatient': this table exists precisely to record the
-- OPD classification, and the column makes that explicit to anything reading the
-- row (matching triages.visit_type, which already uses Inpatient/Outpatient).
CREATE TABLE IF NOT EXISTS opd_followups (
    followup_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    patient_id    INT UNSIGNED NOT NULL,
    admission_id  INT UNSIGNED NULL COMMENT 'the discharge that generated this follow-up',
    clinic_id     INT UNSIGNED NULL,
    diagnosis_id  INT UNSIGNED NULL COMMENT 'clinical thread this visit continues',
    doctor_id     INT UNSIGNED NULL COMMENT 'attending doctor at discharge',
    visit_type    ENUM('Outpatient') NOT NULL DEFAULT 'Outpatient',
    followup_date DATE         NOT NULL,
    status        ENUM('Scheduled','Completed','Missed','Cancelled') NOT NULL DEFAULT 'Scheduled',
    classified_by ENUM('Auto','Manual') NOT NULL DEFAULT 'Auto'
                  COMMENT 'whether the clinic was routed automatically or chosen by hand',
    routing_basis VARCHAR(120) NULL
                  COMMENT 'what the automatic choice was made from, e.g. "specialization: Surgery"',
    notes         TEXT         NULL,
    created_by    INT UNSIGNED NULL COMMENT 'users.user_id who confirmed the discharge',
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (followup_id),
    -- One follow-up per discharge. Makes the create step in confirmDischarge
    -- safe to retry, and makes "discharged twice with two bookings" impossible.
    UNIQUE KEY uq_opd_followup_admission (admission_id),
    KEY idx_opd_followup_patient (patient_id, followup_date),
    KEY idx_opd_followup_clinic  (clinic_id, followup_date),
    KEY idx_opd_followup_status  (status, followup_date),
    CONSTRAINT fk_opd_followup_patient
        FOREIGN KEY (patient_id)   REFERENCES patients   (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    -- SET NULL, never CASCADE: the clinical record of the visit outlives the
    -- admission row, the clinic, and the account that booked it.
    CONSTRAINT fk_opd_followup_admission
        FOREIGN KEY (admission_id) REFERENCES admissions (admission_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_opd_followup_clinic
        FOREIGN KEY (clinic_id)    REFERENCES opd_clinics (clinic_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_opd_followup_diagnosis
        FOREIGN KEY (diagnosis_id) REFERENCES diagnoses  (diagnosis_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_opd_followup_doctor
        FOREIGN KEY (doctor_id)    REFERENCES doctors    (doctor_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_opd_followup_created_by
        FOREIGN KEY (created_by)   REFERENCES users      (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NOTE: already-discharged admissions are deliberately NOT backfilled with
-- invented follow-up dates. A fabricated appointment is worse than a missing
-- one — those discharges happened before the rule existed, and the patient
-- history simply shows no OPD record for them.
