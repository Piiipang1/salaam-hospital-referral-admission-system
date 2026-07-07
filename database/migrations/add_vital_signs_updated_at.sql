-- Adds updated_at to vital_signs so re-recorded vitals preserve the original
-- creation time (recorded_at) and track the last modification separately.
-- Pairs with the addVitalSigns upsert in backend/controllers/triages.controller.js.

USE salaam_hospital;

ALTER TABLE vital_signs
  ADD COLUMN updated_at DATETIME NULL DEFAULT NULL AFTER recorded_at;
