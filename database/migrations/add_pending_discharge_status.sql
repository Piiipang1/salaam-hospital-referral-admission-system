-- Two-step discharge: doctor initiates ('Pending Discharge'), nurse confirms
-- ('Discharged' + discharge_date + room freed). MODIFY adding an ENUM value
-- is safe for existing rows.

USE salaam_hospital;

ALTER TABLE admissions MODIFY COLUMN status
  ENUM('Pending Room','Active','Pending Discharge','Discharged')
  NOT NULL DEFAULT 'Pending Room';
