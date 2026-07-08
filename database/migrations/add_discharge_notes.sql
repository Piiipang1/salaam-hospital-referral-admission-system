-- Optional discharge notes / final assessment written by the doctor when
-- initiating a discharge (dischargePatient). Shown to the nurse before they
-- confirm. Nullable — notes are optional.

USE salaam_hospital;

ALTER TABLE admissions
  ADD COLUMN discharge_notes TEXT NULL DEFAULT NULL AFTER discharge_date;
