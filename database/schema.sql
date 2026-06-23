-- =============================================================================
-- Salaam Hospital Referral and Admission System
-- Database Schema — Definitive Version
-- Generated from: Full codebase dependency audit (June 15, 2026)
-- Engine:  MySQL 5.7+ / MariaDB 10.3+ (XAMPP compatible)
-- Charset: utf8mb4 / utf8mb4_unicode_ci
-- =============================================================================
-- ENUM values sourced directly from controller validation logic:
--   users.role           : admin, doctor, nurse, staff
--   doctors/employees.employment_status : Active, Inactive
--   employees.role       : nurse, staff, admin
--   patients.sex         : Male, Female, Other
--   rooms.availability_status : available, occupied
--   triages.triage_level : Critical, Urgent, Non-Urgent
--   referrals.status     : Pending, Accepted, Completed, Cancelled
--   admissions.status    : Active, Discharged
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
    contact_details    VARCHAR(150)    DEFAULT NULL,
    employment_status  ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (doctor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- employees
-- Not directly queried — exists as FK target for triages.employee_id
-- Columns from code: employee_id (FK value only)
-- -----------------------------------------------------------------------------
CREATE TABLE employees (
    employee_id        INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    first_name         VARCHAR(100)    NOT NULL,
    last_name          VARCHAR(100)    NOT NULL,
    role               ENUM('nurse','staff','admin') NOT NULL DEFAULT 'staff',
    contact_details    VARCHAR(150)    DEFAULT NULL,
    employment_status  ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
    created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (employee_id)
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
    bed_number          VARCHAR(20)     NOT NULL,
    availability_status ENUM('available','occupied') NOT NULL DEFAULT 'available',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id),
    UNIQUE KEY uq_room_bed (room_type, bed_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------------------
-- users
-- Queried by: auth.controller, users.controller, referrals.controller
-- Columns from code: user_id, username, password_hash, role,
--                    linked_id, is_active, created_at
-- ENUM from auth.controller + users.controller: admin, doctor, nurse, staff
-- linked_id → doctors.doctor_id OR employees.employee_id (soft reference, no FK)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    user_id       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    username      VARCHAR(100)    NOT NULL,
    password_hash VARCHAR(255)    NOT NULL,
    role          ENUM('admin','doctor','nurse','staff') NOT NULL,
    linked_id     INT UNSIGNED    DEFAULT NULL,
    is_active     TINYINT(1)      NOT NULL DEFAULT 1,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: linked_id is intentionally NOT a hard FK because it points to different
-- tables depending on role (doctors for role='doctor', employees for nurse/staff).
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
--                    temperature, respiratory_rate, recorded_at
-- One record per triage — controller DELETEs and re-INSERTs on update
-- -----------------------------------------------------------------------------
CREATE TABLE vital_signs (
    vs_id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    triage_id         INT UNSIGNED    NOT NULL,
    blood_pressure    VARCHAR(20)     NOT NULL,
    heart_rate        SMALLINT UNSIGNED NOT NULL COMMENT 'beats per minute',
    temperature       DECIMAL(4,1)    NOT NULL COMMENT 'degrees Celsius',
    respiratory_rate  SMALLINT UNSIGNED NOT NULL COMMENT 'breaths per minute',
    recorded_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
-- Columns from code: referral_id, diagnosis_id, referring_doctor_id,
--                    assigned_doctor_id, referral_date, status
-- ENUM from referrals.controller validStatuses: Pending, Accepted, Completed, Cancelled
-- -----------------------------------------------------------------------------
CREATE TABLE referrals (
    referral_id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    diagnosis_id         INT UNSIGNED    NOT NULL,
    referring_doctor_id  INT UNSIGNED    DEFAULT NULL,
    assigned_doctor_id   INT UNSIGNED    NOT NULL,
    referral_date        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status               ENUM('Pending','Accepted','Completed','Cancelled')
                                         NOT NULL DEFAULT 'Pending',
    PRIMARY KEY (referral_id),
    CONSTRAINT fk_referrals_diagnosis
        FOREIGN KEY (diagnosis_id)        REFERENCES diagnoses (diagnosis_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_referrals_referring_doc
        FOREIGN KEY (referring_doctor_id) REFERENCES doctors   (doctor_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_referrals_assigned_doc
        FOREIGN KEY (assigned_doctor_id)  REFERENCES doctors   (doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ─── TIER 7 ──────────────────────────────────────────────────────────────────

-- -----------------------------------------------------------------------------
-- admissions
-- Queried by: admissions.controller, patients.controller,
--             reports.controller, dashboard.controller
-- Columns from code: admission_id, patient_id, diagnosis_id, doctor_id,
--                    room_id, admission_type, admission_date,
--                    discharge_date, status
-- ENUM from admissions.controller: Active, Discharged
-- Uses DB transaction (getConnection + beginTransaction) in createAdmission
-- and dischargePatient — pool must support getConnection() ✅ (mysql2 pool)
-- -----------------------------------------------------------------------------
CREATE TABLE admissions (
    admission_id    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    patient_id      INT UNSIGNED    NOT NULL,
    diagnosis_id    INT UNSIGNED    DEFAULT NULL,
    doctor_id       INT UNSIGNED    NOT NULL,
    room_id         INT UNSIGNED    NOT NULL,
    admission_type  VARCHAR(100)    NOT NULL,
    admission_date  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    discharge_date  DATETIME        DEFAULT NULL,
    status          ENUM('Active','Discharged') NOT NULL DEFAULT 'Active',
    PRIMARY KEY (admission_id),
    CONSTRAINT fk_admissions_patient
        FOREIGN KEY (patient_id)   REFERENCES patients  (patient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
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
    PRIMARY KEY (dic_id),
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
    is_read          TINYINT(1)      NOT NULL DEFAULT 0,
    created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id),
    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id)     REFERENCES users     (user_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_notifications_referral
        FOREIGN KEY (referral_id) REFERENCES referrals (referral_id)
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
