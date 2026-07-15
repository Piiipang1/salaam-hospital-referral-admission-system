-- =============================================================================
-- Deduplicate doctor_in_charge — enforce "at most one row per patient".
--
-- createDiagnosis used to blindly INSERT a new doctor_in_charge row on every
-- diagnosis, so patients accumulated multiple concurrent rows. That silently
-- widened ASSIGNED_PATIENTS_SUBQUERY (backend/utils/scoping.js) and made the
-- unassigned-patients pool unreliable. The controller now uses replace
-- semantics (DELETE then INSERT, matching assignTriageDoctor); this migration
-- cleans up existing data, keeping only the most recent assigned_at row per
-- patient (ties broken by highest dic_id).
--
-- Safe to run more than once — a deduplicated table is a no-op.
-- If your production database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

DELETE dic FROM doctor_in_charge dic
JOIN doctor_in_charge newer
  ON newer.patient_id = dic.patient_id
 AND (newer.assigned_at > dic.assigned_at
      OR (newer.assigned_at = dic.assigned_at AND newer.dic_id > dic.dic_id));
