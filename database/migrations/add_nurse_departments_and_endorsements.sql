-- =============================================================================
-- Nurse departments + patient assignments + shift endorsements
--
-- Three related additions:
--   1. DEPARTMENTS — the wards already exist as the free-text rooms.room_type
--      string ('ICU', 'General Ward', …). This promotes them to a real table so
--      a nurse can belong to one and "the patients in my ward" is a join, not a
--      string comparison. Existing room types are adopted automatically.
--   2. NURSE ASSIGNMENTS — which nurse is responsible for which patient right
--      now. Assignment is per-stay: it is released when the shift is handed off
--      or the patient is discharged.
--   3. ENDORSEMENTS — the shift handoff itself. The outgoing nurse names the
--      incoming nurse, attaches the patients being handed over with a note per
--      patient, and the endorsement stays Pending until the incoming nurse
--      acknowledges it. Acknowledging is what actually moves the assignments.
--
-- Mirrors the doctor_in_charge propose/accept pattern already in the system:
-- a handoff nobody has accepted is not a handoff.
--
-- Safe on populated tables: every added column is nullable, and the backfills
-- only fill in what is derivable from existing data.
-- If your database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

-- 1. Departments --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
    department_id INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    name          VARCHAR(100)    NOT NULL,
    description   VARCHAR(255)    DEFAULT NULL,
    is_active     TINYINT(1)      NOT NULL DEFAULT 1
                                  COMMENT '0 = retired; hidden from pickers, kept for history',
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (department_id),
    UNIQUE KEY uq_department_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Adopt the wards that already exist as room types, so no room is left
-- department-less and admins do not have to re-key the list.
INSERT IGNORE INTO departments (name)
SELECT DISTINCT room_type FROM rooms WHERE room_type IS NOT NULL AND TRIM(room_type) <> '';

-- 2. Rooms belong to a department ---------------------------------------------
-- This is the link that makes a ward roster possible: patient → admission →
-- room → department.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS department_id INT UNSIGNED NULL
    COMMENT 'Ward this bed belongs to; derived from room_type on migration'
    AFTER room_type;

ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_department
    FOREIGN KEY IF NOT EXISTS (department_id) REFERENCES departments (department_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

UPDATE rooms r
  JOIN departments d ON d.name = r.room_type
  SET r.department_id = d.department_id
  WHERE r.department_id IS NULL;

-- 3. Nurses belong to a department --------------------------------------------
-- One department per employee. SET NULL on delete: removing a ward must never
-- delete staff records.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS department_id INT UNSIGNED NULL
    COMMENT 'Ward this nurse works; NULL = unassigned'
    AFTER role;

ALTER TABLE employees
  ADD CONSTRAINT fk_employees_department
    FOREIGN KEY IF NOT EXISTS (department_id) REFERENCES departments (department_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_department ON employees (department_id);

-- 4. Patient → nurse assignments ----------------------------------------------
-- released_at NULL means "currently responsible". History is kept: a released
-- row is the record of who held the patient during an earlier shift.
--
-- active_patient_id is a generated mirror of patient_id that goes NULL the
-- moment the row is released. The UNIQUE key on it therefore enforces
-- INVARIANT: at most one ACTIVE nurse per patient — while allowing any number
-- of released historical rows (NULLs do not collide in a unique index).
CREATE TABLE IF NOT EXISTS nurse_assignments (
    assignment_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    patient_id    INT UNSIGNED NOT NULL,
    nurse_id      INT UNSIGNED NOT NULL COMMENT 'employees.employee_id',
    department_id INT UNSIGNED NULL     COMMENT 'ward at time of assignment',
    admission_id  INT UNSIGNED NULL     COMMENT 'the stay this covers, when admitted',
    assigned_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by   INT UNSIGNED NULL     COMMENT 'users.user_id who made the assignment',
    released_at   DATETIME     NULL     COMMENT 'NULL = currently responsible',
    release_reason VARCHAR(100) NULL    COMMENT 'Endorsed / Released / Discharged',
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

-- 5. Shift endorsements -------------------------------------------------------
-- status Pending → Acknowledged. Acknowledging is what transfers the patient
-- assignments to the incoming nurse (see endorsements.controller), so an
-- unacknowledged handoff leaves responsibility exactly where it was.
CREATE TABLE IF NOT EXISTS endorsements (
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

-- 6. The patients carried by an endorsement -----------------------------------
-- One row per patient handed over, each with its own note — the actual content
-- of a nursing handoff. patient_condition is a free-text snapshot so the note
-- still reads correctly later even if the patient's chart moves on.
CREATE TABLE IF NOT EXISTS endorsement_patients (
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
