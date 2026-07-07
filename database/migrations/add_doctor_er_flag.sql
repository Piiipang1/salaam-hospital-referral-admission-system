-- ER assignment flag on doctors: only ER-assigned doctors may admit patients
-- (enforced in admissions.controller createAdmission with a fresh DB read).

USE salaam_hospital;

ALTER TABLE doctors
  ADD COLUMN is_er_assigned TINYINT(1) NOT NULL DEFAULT 0 AFTER specialization;
