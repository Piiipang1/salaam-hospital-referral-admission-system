-- Classifies a visit as Inpatient (admitted to a bed) or Outpatient
-- (seen and sent home). NULL until the doctor records a disposition.
ALTER TABLE triages
    ADD COLUMN visit_type ENUM('Inpatient','Outpatient')
    DEFAULT NULL AFTER triage_level;
