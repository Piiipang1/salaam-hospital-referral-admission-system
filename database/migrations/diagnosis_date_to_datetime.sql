-- Migration: Change diagnosis_date in diagnoses table from DATE to DATETIME
-- Description: Supports timestamp granularity for patient diagnoses to align with live DB implementation.
USE salaam_hospital;

ALTER TABLE diagnoses 
  MODIFY COLUMN diagnosis_date DATETIME NOT NULL;
