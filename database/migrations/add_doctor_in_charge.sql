-- Doctor-in-Charge (DIC) mode: an admin-toggleable flag on doctor accounts that
-- grants elevated visibility (all patients, doctor workload, referral reassign).
-- Capped at 3 concurrent by users.controller MAX_DOCTORS_IN_CHARGE.

USE salaam_hospital;

ALTER TABLE users
  ADD COLUMN is_doctor_in_charge TINYINT(1) NOT NULL DEFAULT 0 AFTER linked_id;
