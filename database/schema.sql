-- =============================================================================
-- Salaam Hospital Referral and Admission System
-- Database Schema — Definitive Version
-- Generated from: Full codebase dependency audit (June 15, 2026)
-- Engine:  MySQL 5.7+ / MariaDB 10.3+ (XAMPP compatible)
-- Charset: utf8mb4 / utf8mb4_unicode_ci
-- =============================================================================
-- ENUM values sourced directly from controller validation logic:
--   users.role           : admin, doctor, nurse
--   doctors/employees.employment_status : Active, Inactive
--   employees.role       : nurse, admin
--   patients.sex         : Male, Female, Other
--   rooms.availability_status : available, occupied
--   triages.triage_level : Critical, Urgent, Non-Urgent
--   referrals.status     : Pending, Accepted, Completed, Cancelled
--   admissions.status    : Pending Room, Active, Pending Discharge, Discharged
--   doctor_assessments.disposition : Admit, Discharge, Refer, Observe
-- =============================================================================

DROP DATABASE IF EXISTS salaam_hospital;
CREATE DATABASE salaam_hospital
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE salaam_hospital;

-- =============================================================================
-- CREATION ORDER (FK-safe — each table only references tables already created)
--
--  Tier 1  doctors, employees, patients, rooms, users
--  Tier 2  visit_rooms        → rooms
--  Tier 3  triages            → patients, employees, visit_rooms
--  Tier 4  vital_signs        → triages
--  Tier 5  diagnoses          → patients, triages, doctors
--  Tier 6  treatments         → diagnoses
--          lab_results        → patients, diagnoses
--          referrals          → diagnoses, doctors
--          doctor_assessments → diagnoses, doctors
--  Tier 7  admissions         → patients, diagnoses, doctors, rooms
--          doctor_in_charge   → doctors, patients
--  Tier 8  notifications      → users, referrals
--  Tier 9  activity_logs      → users
-- =============================================================================


-- ─── TIER 1 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- doctors
-- Queried by: diagnoses.controller, referrals.controller,
--             admissions.controller, reports.controller, dashboard.controller
-- Columns from code: doctor_id, first_name, last_name, specialization,
--                    employment_status
-- -----------------------------------------------------------------------------
CREATE TABLE doctors (
    doctor_id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    first_name         VARCHAR(100)    NOT NULL,
    last_name          VARCHAR(100)    NOT NULL,
    specialization     VARCHAR(150)    DEFAULT NULL,
    is_er_assigned     TINYINT(1)      NOT NULL DEFAULT 0,
    contact_details    VARCHAR(150)    DEFAULT NULL,
    employment_status  ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (doctor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- departments (see migrations/add_nurse_departments_and_endorsements.sql)
-- Queried by: departments.controller, nursing.controller, endorsements.controller
-- Columns from code: department_id, name, description, is_active
--
-- The wards. Originally these existed only as the free-text rooms.room_type
-- string; promoting them to a table is what lets a nurse belong to a ward and
-- makes "the patients in my ward" a join (patient → admission → room →
-- department) instead of a string comparison.
-- -----------------------------------------------------------------------------
CREATE TABLE departments (
    department_id INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    name          VARCHAR(100)    NOT NULL,
    description   VARCHAR(255)    DEFAULT NULL,
    is_active     TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '0 = retired; hidden from pickers, kept for history',
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (department_id),
    UNIQUE KEY uq_department_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- employees
-- Queried by: employees.controller, nursing.controller, endorsements.controller
-- Columns from code: employee_id, first_name, last_name, role, department_id
-- -----------------------------------------------------------------------------
CREATE TABLE employees (
    employee_id        INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    first_name         VARCHAR(100)    NOT NULL,
    last_name          VARCHAR(100)    NOT NULL,
    role               ENUM('nurse','admin') NOT NULL DEFAULT 'nurse',
    department_id      INT UNSIGNED    DEFAULT NULL COMMENT 'Ward this nurse works; NULL = unassigned',
    contact_details    VARCHAR(150)    DEFAULT NULL,
    employment_status  ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (employee_id),
    KEY idx_employees_department (department_id),
    -- SET NULL: retiring a ward must never delete the nurses who worked it.
    CONSTRAINT fk_employees_department
        FOREIGN KEY (department_id) REFERENCES departments (department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- patients
-- Queried by: patients.controller, triages.controller, diagnoses.controller,
--             referrals.controller, admissions.controller,
--             reports.controller, dashboard.controller
-- Columns from code: patient_id, first_name, last_name, sex, date_of_birth,
--                    contact_number, address, emergency_contact_name,
--                    emergency_contact_number, created_at
-- -----------------------------------------------------------------------------
CREATE TABLE patients (
    patient_id                INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    first_name                VARCHAR(100)    NOT NULL,
    last_name                 VARCHAR(100)    NOT NULL,
    sex                       ENUM('Male','Female','Other') NOT NULL,
    date_of_birth             DATE            NOT NULL,
    contact_number            VARCHAR(20)     DEFAULT NULL,
    address                   TEXT            DEFAULT NULL,
    emergency_contact_name    VARCHAR(200)    DEFAULT NULL,
    emergency_contact_number  VARCHAR(20)     DEFAULT NULL,
    is_unidentified           TINYINT(1)      NOT NULL DEFAULT 0,
    created_at                DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- rooms
-- Queried by: rooms.controller, admissions.controller,
--             patients.controller, reports.controller, dashboard.controller
-- Columns from code: room_id, room_type, bed_number, availability_status
-- ENUM from admissions.controller: 'available', 'occupied'
-- -----------------------------------------------------------------------------
CREATE TABLE rooms (
    room_id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    room_type           VARCHAR(100)    NOT NULL,
    department_id       INT UNSIGNED    DEFAULT NULL COMMENT 'Ward this bed belongs to; derived from room_type',
    bed_number          VARCHAR(20)     NOT NULL,
    availability_status ENUM('available','occupied') NOT NULL DEFAULT 'available',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id),
    UNIQUE KEY uq_room_bed (room_type, bed_number),
    CONSTRAINT fk_rooms_department
        FOREIGN KEY (department_id) REFERENCES departments (department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- external_hospitals (see migrations/add_external_hospitals.sql)
-- Queried by: externalHospitals.controller, referrals.controller
-- Columns from code: hospital_id, name, contact_number, address, is_active
--
-- Admin-managed directory of the facilities patients are diverted TO when this
-- hospital is at capacity. referrals.external_hospital_id points here; the
-- referrals.external_hospital_* columns keep the snapshot taken at referral
-- time, so correcting an entry never rewrites clinical history.
--
-- is_active = 0 retires an entry: hidden from the referral form's dropdown,
-- still resolvable for referrals that already reference it.
-- -----------------------------------------------------------------------------
CREATE TABLE external_hospitals (
    hospital_id    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    name           VARCHAR(200)    NOT NULL,
    contact_number VARCHAR(50)     DEFAULT NULL,
    address        VARCHAR(255)    DEFAULT NULL,
    is_active      TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '0 = retired; hidden from the referral form, kept for history',
    created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (hospital_id),
    UNIQUE KEY uq_external_hospital_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- users
-- Queried by: auth.controller, users.controller, referrals.controller
-- Columns from code: user_id, username, password_hash, role,
--                    linked_id, is_active, created_at
-- ENUM from auth.controller + users.controller: admin, doctor, nurse
-- (the legacy 'staff' role was removed — see migrations/remove_staff_role.sql)
-- linked_id → doctors.doctor_id OR employees.employee_id (soft reference, no FK)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    user_id       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    username      VARCHAR(100)    NOT NULL,
    -- Alert destinations (see migrations/add_multichannel_alerts.sql). Held on
    -- the account, not the person record: an admin has no doctors/employees row
    -- to hang contact details off, and the account is what receives an alert.
    email          VARCHAR(191)   DEFAULT NULL COMMENT 'Alert destination for the email channel',
    phone          VARCHAR(20)    DEFAULT NULL COMMENT 'E.164 or local mobile; SMS channel destination',
    alerts_opt_out TINYINT(1)     NOT NULL DEFAULT 0 COMMENT '1 = in-app only for this account',
    password_hash VARCHAR(255)    NOT NULL,
    role          ENUM('admin','doctor','nurse') NOT NULL,
    linked_id     INT UNSIGNED    DEFAULT NULL,
    is_doctor_in_charge TINYINT(1) NOT NULL DEFAULT 0,
    is_active     TINYINT(1)      NOT NULL DEFAULT 1,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_username (username),
    -- NULLs do not collide in a UNIQUE index, so this stops two accounts sharing
    -- an alert destination without forcing every account to have one.
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: linked_id is intentionally NOT a hard FK because it points to different
-- tables depending on role (doctors for role='doctor', employees for nurse).
-- Application code in auth.controller and referrals.controller handles this.


-- ─── TIER 2 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- visit_rooms
-- Not directly queried — exists as FK target for triages.visit_room_id
-- Represents consultation/examination rooms (distinct from admission rooms)
-- Columns from code: visit_room_id (FK value only)
-- -----------------------------------------------------------------------------
CREATE TABLE visit_rooms (
    visit_room_id  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    room_id        INT UNSIGNED    DEFAULT NULL,
    room_label     VARCHAR(100)    NOT NULL,
    created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (visit_room_id),
    CONSTRAINT fk_visit_rooms_room
        FOREIGN KEY (room_id) REFERENCES rooms (room_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── TIER 3 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- triages
-- Queried by: triages.controller, patients.controller,
--             reports.controller, dashboard.controller
-- Columns from code: triage_id, patient_id, employee_id, visit_room_id,
--                    triage_level, notes, triage_datetime
-- ENUM from triages.controller validLevels: Critical, Urgent, Non-Urgent
-- -----------------------------------------------------------------------------
CREATE TABLE triages (
    triage_id       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    patient_id      INT UNSIGNED    NOT NULL,
    employee_id     INT UNSIGNED    DEFAULT NULL,
    visit_room_id   INT UNSIGNED    DEFAULT NULL,
    triage_level    ENUM('Critical','Urgent','Non-Urgent') NOT NULL,
    visit_type      ENUM('Inpatient','Outpatient') DEFAULT NULL,
    notes           TEXT            DEFAULT NULL,
    triage_datetime DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (triage_id),
    CONSTRAINT fk_triages_patient
        FOREIGN KEY (patient_id)    REFERENCES patients    (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_triages_employee
        FOREIGN KEY (employee_id)   REFERENCES employees   (employee_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_triages_visit_room
        FOREIGN KEY (visit_room_id) REFERENCES visit_rooms (visit_room_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── TIER 4 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- vital_signs
-- Queried by: triages.controller, patients.controller
-- Columns from code: vs_id, triage_id, blood_pressure, heart_rate,
--                    temperature, respiratory_rate, recorded_at, updated_at
-- One record per triage — controller upserts: INSERT on first record,
-- UPDATE (preserving recorded_at, stamping updated_at) on re-record
-- -----------------------------------------------------------------------------
CREATE TABLE vital_signs (
    vs_id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    triage_id         INT UNSIGNED    NOT NULL,
    blood_pressure    VARCHAR(20)     NOT NULL,
    heart_rate        SMALLINT UNSIGNED NOT NULL COMMENT 'beats per minute',
    temperature       DECIMAL(4,1)    NOT NULL COMMENT 'degrees Celsius',
    respiratory_rate  SMALLINT UNSIGNED NOT NULL COMMENT 'breaths per minute',
    recorded_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME        NULL DEFAULT NULL,
    PRIMARY KEY (vs_id),
    CONSTRAINT fk_vital_signs_triage
        FOREIGN KEY (triage_id) REFERENCES triages (triage_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── TIER 5 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- diagnoses
-- Queried by: diagnoses.controller, patients.controller,
--             referrals.controller, reports.controller
-- Columns from code: diagnosis_id, patient_id, triage_id, doctor_id,
--                    medical_condition, diagnosis_date
-- -----------------------------------------------------------------------------
CREATE TABLE diagnoses (
    diagnosis_id      INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    patient_id        INT UNSIGNED    NOT NULL,
    triage_id         INT UNSIGNED    DEFAULT NULL,
    doctor_id         INT UNSIGNED    NOT NULL,
    medical_condition TEXT            NOT NULL,
    diagnosis_date    DATE            NOT NULL,
    PRIMARY KEY (diagnosis_id),
    CONSTRAINT fk_diagnoses_patient
        FOREIGN KEY (patient_id) REFERENCES patients (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_diagnoses_triage
        FOREIGN KEY (triage_id)  REFERENCES triages  (triage_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_diagnoses_doctor
        FOREIGN KEY (doctor_id)  REFERENCES doctors  (doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── TIER 6 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- treatments
-- Queried by: diagnoses.controller (INSERT, SELECT)
-- Columns from code: treatment_id, diagnosis_id, prescribed_medications,
--                    dosage, frequency, treatment_duration
-- created_at not queried — auto-populated by DEFAULT
-- -----------------------------------------------------------------------------
CREATE TABLE treatments (
    treatment_id           INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    diagnosis_id           INT UNSIGNED    NOT NULL,
    prescribed_medications TEXT            NOT NULL,
    dosage                 VARCHAR(150)    DEFAULT NULL,
    frequency              VARCHAR(150)    DEFAULT NULL,
    treatment_duration     VARCHAR(100)    DEFAULT NULL,
    created_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (treatment_id),
    CONSTRAINT fk_treatments_diagnosis
        FOREIGN KEY (diagnosis_id) REFERENCES diagnoses (diagnosis_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- lab_results
-- Queried by: diagnoses.controller (INSERT, SELECT by diagnosis_id)
-- Columns from code: lab_result_id, patient_id, diagnosis_id, test_type,
--                    results, file_attachment, date_conducted
-- file_attachment stores filename string from multer (backend/uploads/)
-- -----------------------------------------------------------------------------
CREATE TABLE lab_results (
    lab_result_id    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    patient_id       INT UNSIGNED    NOT NULL,
    diagnosis_id     INT UNSIGNED    NOT NULL,
    test_type        VARCHAR(200)    NOT NULL,
    results          TEXT            DEFAULT NULL,
    file_attachment  VARCHAR(255)    DEFAULT NULL COMMENT 'filename saved in backend/uploads/',
    date_conducted   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lab_result_id),
    CONSTRAINT fk_lab_results_patient
        FOREIGN KEY (patient_id)   REFERENCES patients  (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_lab_results_diagnosis
        FOREIGN KEY (diagnosis_id) REFERENCES diagnoses (diagnosis_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- referrals
-- Queried by: referrals.controller, patients.controller,
--             reports.controller, dashboard.controller
-- Columns from code: referral_id, diagnosis_id, patient_id, referring_doctor_id,
--                    assigned_doctor_id, referral_date, status, e_signature,
--                    file_attachment, is_external, external_hospital_name,
--                    external_hospital_contact, external_hospital_address,
--                    external_reason, created_by
-- ENUM from referrals.controller validStatuses: Pending, Accepted, Completed, Cancelled
-- e_signature stores a base64 PNG data URL captured from the signature canvas
-- in ReferralForm (frontend) — nullable, referrals may be submitted without one
-- file_attachment stores the multer filename (backend/uploads/) of an optional
-- referral form document uploaded with the referral
--
-- TWO KINDS OF REFERRAL (see migrations/add_external_referrals.sql):
--   internal (is_external = 0) — handed to a doctor in THIS system.
--     assigned_doctor_id set; full Pending → Accepted → Completed lifecycle.
--   external (is_external = 1) — patient diverted to an OUTSIDE hospital,
--     typically because this facility has no available beds. There is no
--     assigned_doctor_id (nobody here receives it) and there may be no
--     diagnosis_id (the patient can be turned away before one is recorded),
--     which is why both columns are nullable. The destination is picked from
--     the external_hospitals directory (external_hospital_id) and copied into
--     the external_hospital_* columns as a point-in-time snapshot — editing a
--     directory entry must never rewrite what a past transfer recorded.
--     Lifecycle skips Accepted: Pending → Completed (transferred) or Cancelled.
--
-- patient_id is the direct patient link, populated for BOTH kinds. Older rows
-- resolved the patient through diagnoses; queries use
-- COALESCE(r.patient_id, diag.patient_id) so both paths work.
-- -----------------------------------------------------------------------------
CREATE TABLE referrals (
    referral_id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    diagnosis_id         INT UNSIGNED    DEFAULT NULL,
    patient_id           INT UNSIGNED    DEFAULT NULL COMMENT 'Direct patient link; required for external referrals, which may have no diagnosis',
    referring_doctor_id  INT UNSIGNED    DEFAULT NULL,
    assigned_doctor_id   INT UNSIGNED    DEFAULT NULL COMMENT 'NULL for external referrals — no doctor in this system receives them',
    referral_date        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status               ENUM('Pending','Accepted','Completed','Cancelled')
                                         NOT NULL DEFAULT 'Pending',
    -- Why the patient is being handed on. Mandatory for new INTERNAL referrals
    -- (enforced in referrals.controller); NULLable because referrals predating
    -- the rule genuinely have none.
    remarks              TEXT            DEFAULT NULL COMMENT 'Why the patient is being referred',
    is_external          TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1 = referred OUT to a hospital outside this system',
    external_hospital_id INT UNSIGNED    DEFAULT NULL COMMENT 'external_hospitals.hospital_id chosen at referral time',
    external_hospital_name    VARCHAR(200) DEFAULT NULL COMMENT 'snapshot of the directory entry as recorded',
    external_hospital_contact VARCHAR(50)  DEFAULT NULL COMMENT 'snapshot',
    external_hospital_address VARCHAR(255) DEFAULT NULL COMMENT 'snapshot',
    external_reason      TEXT            DEFAULT NULL COMMENT 'Why the patient was diverted (e.g. no available beds)',
    created_by           INT UNSIGNED    DEFAULT NULL COMMENT 'users.user_id who recorded it — nurses may create external referrals and are not doctors',
    e_signature          TEXT            DEFAULT NULL,
    file_attachment      VARCHAR(255)    DEFAULT NULL COMMENT 'filename saved in backend/uploads/',
    PRIMARY KEY (referral_id),
    CONSTRAINT fk_referrals_diagnosis
        FOREIGN KEY (diagnosis_id)        REFERENCES diagnoses (diagnosis_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_referrals_patient
        FOREIGN KEY (patient_id)          REFERENCES patients  (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_referrals_created_by
        FOREIGN KEY (created_by)          REFERENCES users     (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    -- SET NULL, never CASCADE: removing a hospital from the directory must not
    -- delete the referrals sent there — the snapshot columns keep them readable.
    CONSTRAINT fk_referrals_external_hospital
        FOREIGN KEY (external_hospital_id) REFERENCES external_hospitals (hospital_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_referrals_referring_doc
        FOREIGN KEY (referring_doctor_id) REFERENCES doctors   (doctor_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_referrals_assigned_doc
        FOREIGN KEY (assigned_doctor_id)  REFERENCES doctors   (doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- doctor_assessments
-- Queried by: diagnoses.controller (saveAssessment, getAssessment)
-- Columns from code: assessment_id, diagnosis_id, doctor_id, clinical_notes,
--                    disposition, assessed_at
-- ENUM from diagnoses.controller validDispositions: Admit, Discharge, Refer, Observe
-- One record per diagnosis — saveAssessment UPSERTs (UPDATE if a row already
-- exists for the diagnosis_id, else INSERT)
-- -----------------------------------------------------------------------------
CREATE TABLE doctor_assessments (
    assessment_id  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    diagnosis_id   INT UNSIGNED    NOT NULL,
    doctor_id      INT UNSIGNED    NOT NULL,
    clinical_notes TEXT            DEFAULT NULL,
    disposition    ENUM('Admit','Discharge','Refer','Observe') NOT NULL,
    assessed_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (assessment_id),
    CONSTRAINT fk_doctor_assessments_diagnosis
        FOREIGN KEY (diagnosis_id) REFERENCES diagnoses (diagnosis_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_doctor_assessments_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors (doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── TIER 7 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- admissions
-- Queried by: admissions.controller, patients.controller,
--             reports.controller, dashboard.controller
-- Columns from code: admission_id, patient_id, diagnosis_id, doctor_id,
--                    room_id, admission_type, admission_date,
--                    discharge_date, discharge_notes, status
-- ENUM from admissions.controller: Pending Room, Active, Pending Discharge, Discharged
-- Uses DB transaction (getConnection + beginTransaction) in createAdmission
-- and dischargePatient — pool must support getConnection() ✅ (mysql2 pool)
-- -----------------------------------------------------------------------------
CREATE TABLE admissions (
    admission_id    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    patient_id      INT UNSIGNED    NOT NULL,
    diagnosis_id    INT UNSIGNED    DEFAULT NULL,
    doctor_id       INT UNSIGNED    NOT NULL,
    room_id         INT UNSIGNED    DEFAULT NULL,
    admission_type  VARCHAR(100)    NOT NULL,
    admission_date  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    discharge_date  DATETIME        DEFAULT NULL,
    discharge_notes TEXT            DEFAULT NULL,
    discharge_confirmed_by INT UNSIGNED DEFAULT NULL,
    status          ENUM('Pending Room','Active','Pending Discharge','Discharged') NOT NULL DEFAULT 'Pending Room',
    PRIMARY KEY (admission_id),
    CONSTRAINT fk_admissions_patient
        FOREIGN KEY (patient_id)   REFERENCES patients  (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_admissions_discharge_confirmed_by
        FOREIGN KEY (discharge_confirmed_by) REFERENCES users (user_id)
        ON DELETE SET NULL,
    CONSTRAINT fk_admissions_diagnosis
        FOREIGN KEY (diagnosis_id) REFERENCES diagnoses (diagnosis_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_admissions_doctor
        FOREIGN KEY (doctor_id)    REFERENCES doctors   (doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_admissions_room
        FOREIGN KEY (room_id)      REFERENCES rooms     (room_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- opd_clinics (see migrations/add_opd_followups.sql)
-- Queried by: opd.controller, admissions.controller (discharge routing)
-- Columns from code: clinic_id, name, specialization, description,
--                    is_default, is_active
--
-- The outpatient clinics a discharge follow-up can be routed to. `specialization`
-- mirrors doctors.specialization and is the key automatic routing matches on;
-- the single is_default = 1 row is the catch-all when nothing else matches.
-- -----------------------------------------------------------------------------
CREATE TABLE opd_clinics (
    clinic_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name           VARCHAR(120) NOT NULL,
    specialization VARCHAR(150) NULL COMMENT 'Matches doctors.specialization — the key automatic routing uses',
    description    VARCHAR(255) NULL,
    is_default     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = catch-all; exactly one row should have this',
    is_active      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (clinic_id),
    UNIQUE KEY uq_opd_clinic_name (name),
    KEY idx_opd_clinic_specialization (specialization)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- opd_followups (see migrations/add_opd_followups.sql)
-- Queried by: opd.controller, admissions.controller (confirmDischarge),
--             patients.controller (getPatientHistory)
-- Columns from code: patient_id, admission_id, clinic_id, diagnosis_id,
--                    doctor_id, visit_type, followup_date, status,
--                    classified_by, routing_basis, notes, created_by
--
-- The outpatient follow-up every discharged inpatient leaves with. Created in
-- the SAME transaction as the discharge, and confirmDischarge refuses without
-- one — so "discharged with no follow-up booked" is not a state this database
-- can hold.
--
-- visit_type is fixed to 'Outpatient': this table exists to record the OPD
-- classification, and the column makes that explicit to anything reading the
-- row (matching triages.visit_type).
--
-- UNIQUE on admission_id gives one follow-up per discharge, which makes the
-- create step safe to retry and double-booking impossible.
-- -----------------------------------------------------------------------------
CREATE TABLE opd_followups (
    followup_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    patient_id    INT UNSIGNED NOT NULL,
    admission_id  INT UNSIGNED NULL COMMENT 'the discharge that generated this follow-up',
    clinic_id     INT UNSIGNED NULL,
    diagnosis_id  INT UNSIGNED NULL COMMENT 'clinical thread this visit continues',
    doctor_id     INT UNSIGNED NULL COMMENT 'attending doctor at discharge',
    visit_type    ENUM('Outpatient') NOT NULL DEFAULT 'Outpatient',
    followup_date DATE         NOT NULL,
    status        ENUM('Scheduled','Completed','Missed','Cancelled') NOT NULL DEFAULT 'Scheduled',
    classified_by ENUM('Auto','Manual') NOT NULL DEFAULT 'Auto',
    routing_basis VARCHAR(120) NULL COMMENT 'what the automatic choice was made from',
    notes         TEXT         NULL,
    created_by    INT UNSIGNED NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (followup_id),
    UNIQUE KEY uq_opd_followup_admission (admission_id),
    KEY idx_opd_followup_patient (patient_id, followup_date),
    KEY idx_opd_followup_clinic  (clinic_id, followup_date),
    KEY idx_opd_followup_status  (status, followup_date),
    CONSTRAINT fk_opd_followup_patient
        FOREIGN KEY (patient_id)   REFERENCES patients    (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    -- SET NULL, never CASCADE: the record of the visit outlives the admission
    -- row, the clinic, and the account that booked it.
    CONSTRAINT fk_opd_followup_admission
        FOREIGN KEY (admission_id) REFERENCES admissions  (admission_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_opd_followup_clinic
        FOREIGN KEY (clinic_id)    REFERENCES opd_clinics (clinic_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_opd_followup_diagnosis
        FOREIGN KEY (diagnosis_id) REFERENCES diagnoses   (diagnosis_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_opd_followup_doctor
        FOREIGN KEY (doctor_id)    REFERENCES doctors     (doctor_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_opd_followup_created_by
        FOREIGN KEY (created_by)   REFERENCES users       (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- discharge_clearance_items (see migrations/add_discharge_clearance.sql)
-- Queried by: admissions.controller (confirmDischarge, clearance endpoints)
-- Columns from code: admission_id, item, verified_by, verified_at, notes
--
-- Mandatory pre-discharge checklist. confirmDischarge refuses until all three
-- items — Billing, Administrative and DoctorOrder — exist for the admission.
--
-- One row PER SATISFIED ITEM rather than three boolean columns: the row's
-- existence IS the verification, so every tick carries its verifier and
-- timestamp, unticking is a DELETE that leaves no misleading residue, and the
-- UNIQUE key makes double-verification impossible.
--
-- DoctorOrder is never hand-ticked by a nurse — it is written when the assigned
-- doctor initiates the discharge and removed if they cancel it. A nurse
-- asserting "the doctor ordered this" is exactly what this table prevents.
-- -----------------------------------------------------------------------------
CREATE TABLE discharge_clearance_items (
    clearance_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    admission_id INT UNSIGNED NOT NULL,
    item         ENUM('Billing','Administrative','DoctorOrder') NOT NULL,
    verified_by  INT UNSIGNED NULL COMMENT 'users.user_id who cleared it',
    verified_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes        VARCHAR(255) NULL COMMENT 'optional remark, e.g. a billing reference',
    PRIMARY KEY (clearance_id),
    UNIQUE KEY uq_clearance_item (admission_id, item),
    CONSTRAINT fk_clearance_admission
        FOREIGN KEY (admission_id) REFERENCES admissions (admission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_clearance_verified_by
        FOREIGN KEY (verified_by)  REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- nurse_assignments (see migrations/add_nurse_departments_and_endorsements.sql)
-- Queried by: nursing.controller, endorsements.controller
-- Columns from code: patient_id, nurse_id, department_id, admission_id,
--                    assigned_at, assigned_by, released_at, release_reason
--
-- Which nurse is responsible for which patient right now. released_at NULL
-- means "currently responsible"; released rows are the record of who held the
-- patient during an earlier shift.
--
-- active_patient_id is a generated mirror of patient_id that goes NULL the
-- moment the row is released, so the UNIQUE key on it enforces
-- INVARIANT: at most one ACTIVE nurse per patient — while allowing any number
-- of released historical rows (NULLs do not collide in a unique index).
-- -----------------------------------------------------------------------------
CREATE TABLE nurse_assignments (
    assignment_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    patient_id     INT UNSIGNED NOT NULL,
    nurse_id       INT UNSIGNED NOT NULL COMMENT 'employees.employee_id',
    department_id  INT UNSIGNED NULL     COMMENT 'ward at time of assignment',
    admission_id   INT UNSIGNED NULL     COMMENT 'the stay this covers, when admitted',
    assigned_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by    INT UNSIGNED NULL     COMMENT 'users.user_id who made the assignment',
    released_at    DATETIME     NULL     COMMENT 'NULL = currently responsible',
    release_reason VARCHAR(100) NULL     COMMENT 'Endorsed / Released / Discharged',
    active_patient_id INT UNSIGNED AS (IF(released_at IS NULL, patient_id, NULL)) PERSISTENT,
    PRIMARY KEY (assignment_id),
    UNIQUE KEY uq_nurse_assignment_active (active_patient_id),
    KEY idx_nurse_assignment_nurse (nurse_id, released_at),
    KEY idx_nurse_assignment_patient (patient_id),
    CONSTRAINT fk_nurse_assign_patient
        FOREIGN KEY (patient_id)    REFERENCES patients    (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_nurse_assign_nurse
        FOREIGN KEY (nurse_id)      REFERENCES employees   (employee_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_nurse_assign_department
        FOREIGN KEY (department_id) REFERENCES departments (department_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_nurse_assign_admission
        FOREIGN KEY (admission_id)  REFERENCES admissions  (admission_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_nurse_assign_by
        FOREIGN KEY (assigned_by)   REFERENCES users       (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- endorsements
-- Queried by: endorsements.controller
-- Columns from code: from_nurse_id, to_nurse_id, department_id, shift,
--                    shift_date, general_notes, status, created_by,
--                    acknowledged_at
--
-- The nursing shift handoff. The outgoing nurse names the incoming nurse and
-- the patients being handed over; the endorsement stays Pending until the
-- incoming nurse acknowledges it. Acknowledging is what actually MOVES the
-- nurse_assignments — an unacknowledged handoff leaves responsibility exactly
-- where it was. Mirrors the doctor_in_charge propose/accept pattern.
--
-- `shift` is the shift ENDING, i.e. the one being handed off.
-- -----------------------------------------------------------------------------
CREATE TABLE endorsements (
    endorsement_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    from_nurse_id   INT UNSIGNED NOT NULL COMMENT 'employees.employee_id handing over',
    to_nurse_id     INT UNSIGNED NOT NULL COMMENT 'employees.employee_id receiving',
    department_id   INT UNSIGNED NULL,
    shift           ENUM('Morning','Afternoon','Night') NOT NULL COMMENT 'the shift ENDING',
    shift_date      DATE         NOT NULL,
    general_notes   TEXT         NULL COMMENT 'ward-wide notes not tied to one patient',
    status          ENUM('Pending','Acknowledged') NOT NULL DEFAULT 'Pending',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      INT UNSIGNED NULL COMMENT 'users.user_id who submitted it',
    acknowledged_at DATETIME     NULL,
    PRIMARY KEY (endorsement_id),
    KEY idx_endorsement_to   (to_nurse_id, status),
    KEY idx_endorsement_from (from_nurse_id),
    KEY idx_endorsement_dept (department_id, shift_date),
    CONSTRAINT fk_endorsement_from_nurse
        FOREIGN KEY (from_nurse_id) REFERENCES employees   (employee_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_endorsement_to_nurse
        FOREIGN KEY (to_nurse_id)   REFERENCES employees   (employee_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_endorsement_department
        FOREIGN KEY (department_id) REFERENCES departments (department_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_endorsement_created_by
        FOREIGN KEY (created_by)    REFERENCES users       (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- endorsement_patients
-- Queried by: endorsements.controller
-- Columns from code: endorsement_id, patient_id, notes
--
-- One row per patient handed over, each with its own note — the actual content
-- of a nursing handoff.
-- -----------------------------------------------------------------------------
CREATE TABLE endorsement_patients (
    endorsement_patient_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    endorsement_id INT UNSIGNED NOT NULL,
    patient_id     INT UNSIGNED NOT NULL,
    notes          TEXT         NULL COMMENT 'what the incoming nurse needs to know',
    PRIMARY KEY (endorsement_patient_id),
    UNIQUE KEY uq_endorsement_patient (endorsement_id, patient_id),
    CONSTRAINT fk_endorsement_patient_endorsement
        FOREIGN KEY (endorsement_id) REFERENCES endorsements (endorsement_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_endorsement_patient_patient
        FOREIGN KEY (patient_id)     REFERENCES patients     (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- doctor_in_charge
-- Queried by: diagnoses.controller (INSERT only)
-- Columns from code: doctor_id, patient_id, assigned_at
-- Auto-created when a diagnosis is recorded (diagnoses.controller line 20)
-- -----------------------------------------------------------------------------
CREATE TABLE doctor_in_charge (
    dic_id      INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    doctor_id   INT UNSIGNED    NOT NULL,
    patient_id  INT UNSIGNED    NOT NULL,
    assigned_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Assignment-acceptance workflow (see migrations/add_assignment_acceptance.sql).
    -- INVARIANT: at most one doctor_in_charge row per patient, of either status.
    status         ENUM('Pending','Accepted') NOT NULL DEFAULT 'Accepted',
    assigned_by    INT UNSIGNED NULL COMMENT 'users.user_id of the proposing DIC',
    responded_at   DATETIME     NULL,
    decline_reason VARCHAR(255) NULL,
    PRIMARY KEY (dic_id),
    KEY idx_dic_assigned_by (assigned_by),
    CONSTRAINT fk_dic_doctor
        FOREIGN KEY (doctor_id)  REFERENCES doctors  (doctor_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_dic_patient
        FOREIGN KEY (patient_id) REFERENCES patients (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── TIER 8 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- notifications
-- Queried by: referrals.controller (INSERT), notifications.controller (SELECT, UPDATE)
-- Columns from code: notification_id, user_id, referral_id, message,
--                    is_read, created_at
-- INSERT in referrals.controller: user_id, message, referral_id
-- SELECT/UPDATE in notifications.controller: all columns
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
    notification_id  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    user_id          INT UNSIGNED    NOT NULL,
    referral_id      INT UNSIGNED    DEFAULT NULL,
    message          TEXT            NOT NULL,
    -- Drives which out-of-band channels fire (backend/utils/notifier.js):
    -- Normal = in-app only, High = + email, Emergency = + email and SMS.
    priority         ENUM('Normal','High','Emergency') NOT NULL DEFAULT 'Normal',
    is_read          TINYINT(1)      NOT NULL DEFAULT 0,
    created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id),
    KEY idx_notifications_priority (priority, created_at),
    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id)     REFERENCES users     (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_notifications_referral
        FOREIGN KEY (referral_id) REFERENCES referrals (referral_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- notification_deliveries (see migrations/add_multichannel_alerts.sql)
-- Queried by: notifier.js (write), admin review of alert delivery
-- Columns from code: notification_id, user_id, channel, destination, status,
--                    provider_ref, detail
--
-- One row per attempted out-of-band send. 'Skipped' covers the honest cases —
-- no address on file, recipient opted out, channel not configured, dispatch
-- disabled — so a non-delivery is always explained rather than silent, which is
-- the difference between "the on-call doctor was not told" and "we think they
-- were told".
-- -----------------------------------------------------------------------------
CREATE TABLE notification_deliveries (
    delivery_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
    notification_id INT UNSIGNED NULL COMMENT 'the in-app notification this mirrors',
    user_id         INT UNSIGNED NULL COMMENT 'recipient account',
    channel         ENUM('email','sms') NOT NULL,
    destination     VARCHAR(191) NULL COMMENT 'address or number actually used',
    status          ENUM('Sent','Failed','Skipped') NOT NULL,
    provider_ref    VARCHAR(191) NULL COMMENT 'provider message id, for support tickets',
    detail          VARCHAR(255) NULL COMMENT 'failure reason, or why it was skipped',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (delivery_id),
    KEY idx_delivery_notification (notification_id),
    KEY idx_delivery_user (user_id, created_at),
    KEY idx_delivery_status (status, created_at),
    CONSTRAINT fk_delivery_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (notification_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    -- SET NULL from users: deleting an account must never erase the record of
    -- what was sent to it.
    CONSTRAINT fk_delivery_user
        FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── TIER 9 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- activity_logs
-- Queried by: ALL mutating controllers (INSERT only)
-- Columns from code: user_id, action, target_table, target_id
-- Action values: LOGIN, LOGOUT, CREATE, UPDATE, UPDATE_STATUS, DEACTIVATE, DISCHARGE
-- log_id and created_at never explicitly inserted — rely on AUTO_INCREMENT and DEFAULT
-- -----------------------------------------------------------------------------
CREATE TABLE activity_logs (
    log_id        INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    user_id       INT UNSIGNED    NOT NULL,
    action        VARCHAR(50)     NOT NULL,
    target_table  VARCHAR(100)    NOT NULL,
    target_id     INT UNSIGNED    NOT NULL,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    CONSTRAINT fk_activity_logs_user
        FOREIGN KEY (user_id) REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- INDEXES
-- Derived from WHERE clauses, JOIN conditions, and ORDER BY found in controllers
-- =============================================================================

-- patients — searched by name LIKE in patients.controller getAllPatients
CREATE INDEX idx_patients_name     ON patients (last_name, first_name);

-- triages — filtered by triage_level (triages.controller) and triage_datetime
--           (reports.controller turnaroundReport, dashboard.controller)
CREATE INDEX idx_triages_level     ON triages (triage_level);
CREATE INDEX idx_triages_datetime  ON triages (triage_datetime);

-- diagnoses — joined to triages in turnaroundReport (diag.triage_id = t.triage_id)
CREATE INDEX idx_diagnoses_triage  ON diagnoses (triage_id);
CREATE INDEX idx_diagnoses_patient ON diagnoses (patient_id);

-- referrals — filtered by status (referrals.controller, reports.controller,
--             dashboard.controller) and assigned_doctor_id (doctor inbox filtering)
CREATE INDEX idx_referrals_status          ON referrals (status);
CREATE INDEX idx_referrals_assigned_doctor ON referrals (assigned_doctor_id);
CREATE INDEX idx_referrals_diagnosis       ON referrals (diagnosis_id);
-- patient_id: getReferralHistory / getPatientHistory filter on it directly
-- is_external: the Referrals page filters internal vs external
CREATE INDEX idx_referrals_patient         ON referrals (patient_id);
CREATE INDEX idx_referrals_external        ON referrals (is_external);

-- admissions — filtered by status (admissions.controller, dashboard.controller)
--              and admission_date (reports.controller date range filter)
CREATE INDEX idx_admissions_status    ON admissions (status);
CREATE INDEX idx_admissions_date      ON admissions (admission_date);
CREATE INDEX idx_admissions_diagnosis ON admissions (diagnosis_id);

-- notifications — queried by user_id (getMyNotifications) and
--                 (user_id + is_read) for unread count (notifications.controller)
CREATE INDEX idx_notifications_user   ON notifications (user_id);
CREATE INDEX idx_notifications_unread ON notifications (user_id, is_read);

-- activity_logs — potential admin queries by user and date
CREATE INDEX idx_activity_logs_user ON activity_logs (user_id);
CREATE INDEX idx_activity_logs_date ON activity_logs (created_at);
