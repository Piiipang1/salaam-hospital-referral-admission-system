-- =============================================================================
-- Mandatory pre-discharge clearance checklist
--
-- A patient may not be discharged until three things are true:
--   Billing        — accounts settled / cleared
--   Administrative — paperwork, records, property returned
--   DoctorOrder    — a doctor has actually ordered the discharge
--
-- Modelled as one row PER SATISFIED ITEM rather than three boolean columns:
--   * presence of the row IS the verification, so there is no "true but by
--     whom, when?" gap — every item carries its verifier and timestamp;
--   * unticking is a DELETE, so a mistaken tick leaves no misleading residue;
--   * the UNIQUE key makes double-verification impossible.
--
-- DoctorOrder is NOT hand-ticked by a nurse. It is recorded automatically when
-- the assigned doctor initiates the discharge (admissions.controller
-- dischargePatient, Active → Pending Discharge) and removed if they cancel it.
-- A nurse ticking "the doctor ordered this" would be asserting something they
-- cannot verify, so the API refuses that item to nurse/staff.
--
-- Safe on populated tables: creates one new table and backfills only the
-- doctor's-order item for discharges already in flight.
-- If your database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

CREATE TABLE IF NOT EXISTS discharge_clearance_items (
    clearance_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    admission_id INT UNSIGNED NOT NULL,
    item         ENUM('Billing','Administrative','DoctorOrder') NOT NULL,
    verified_by  INT UNSIGNED NULL COMMENT 'users.user_id who cleared it; NULL if that account was deleted',
    verified_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes        VARCHAR(255) NULL COMMENT 'optional remark, e.g. a billing reference',
    PRIMARY KEY (clearance_id),
    -- One clearance per item per admission: the row's existence is the tick.
    UNIQUE KEY uq_clearance_item (admission_id, item),
    CONSTRAINT fk_clearance_admission
        FOREIGN KEY (admission_id) REFERENCES admissions (admission_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    -- SET NULL, matching admissions.discharge_confirmed_by: deleting a user
    -- account must never delete the clearance record they signed.
    CONSTRAINT fk_clearance_verified_by
        FOREIGN KEY (verified_by)  REFERENCES users (user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: a discharge already awaiting nurse confirmation was, by definition,
-- ordered by a doctor before this checklist existed. Record that item so those
-- in-flight discharges are not blocked by an order that predates the feature.
-- Billing and Administrative are deliberately NOT backfilled — those genuinely
-- have not been done, and asserting otherwise is exactly what this table exists
-- to prevent.
INSERT IGNORE INTO discharge_clearance_items (admission_id, item, verified_by, notes)
SELECT a.admission_id, 'DoctorOrder',
       (SELECT u.user_id FROM users u
         WHERE u.role = 'doctor' AND u.linked_id = a.doctor_id
         ORDER BY u.is_active DESC LIMIT 1),
       'Recorded by migration: discharge was already ordered before the checklist existed'
FROM admissions a
WHERE a.status = 'Pending Discharge';
