-- =============================================================================
-- Assignment-acceptance workflow for doctor_in_charge.
--
-- A Doctor-in-Charge now PROPOSES an attending doctor: the row is created with
-- status='Pending' and the proposed doctor must Accept (status -> 'Accepted')
-- or Decline (row deleted, patient returns to the unassigned pool). A DIC
-- assigning THEMSELVES skips the handshake (inserted directly as 'Accepted').
--
--   status         Pending | Accepted. DEFAULT 'Accepted' keeps every existing
--                  row and all pre-migration behavior valid.
--   assigned_by    users.user_id of the DIC who proposed the assignment
--                  (NULL on legacy rows and rows written by createDiagnosis).
--   responded_at   when the doctor accepted (NULL while Pending).
--   decline_reason reserved; declines currently DELETE the row and carry the
--                  reason in the DIC notification, so this stays NULL unless a
--                  'Declined' status is ever retained.
--
-- INVARIANT (enforced in code, commented at every write site):
--   AT MOST ONE doctor_in_charge row per patient, of either status.
--
-- Safe to run more than once except the ALTERs — if a statement errors with
-- "Duplicate column name" it is already applied; skip it and continue.
-- If your production database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

-- 1. Dedup first (idempotent; self-contained even if dedupe_doctor_in_charge.sql
--    was never run): keep only the most recent assigned_at row per patient,
--    ties broken by highest dic_id.
DELETE dic FROM doctor_in_charge dic
JOIN doctor_in_charge newer
  ON newer.patient_id = dic.patient_id
 AND (newer.assigned_at > dic.assigned_at
      OR (newer.assigned_at = dic.assigned_at AND newer.dic_id > dic.dic_id));

-- 2. Lifecycle columns.
ALTER TABLE doctor_in_charge
  ADD COLUMN status ENUM('Pending','Accepted') NOT NULL DEFAULT 'Accepted' AFTER assigned_at,
  ADD COLUMN assigned_by INT UNSIGNED NULL AFTER status,
  ADD COLUMN responded_at DATETIME NULL AFTER assigned_by,
  ADD COLUMN decline_reason VARCHAR(255) NULL AFTER responded_at;

-- 3. Index the proposer for the DIC "limbo ownership" scope lookups.
ALTER TABLE doctor_in_charge
  ADD KEY idx_dic_assigned_by (assigned_by);
