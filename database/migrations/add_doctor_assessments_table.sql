-- Doctor Assessment (Doctor_Planning use case) — clinical notes + disposition,
-- one record per diagnosis, captured/updated by the assigned doctor.
CREATE TABLE doctor_assessments (
    assessment_id  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    diagnosis_id   INT UNSIGNED    NOT NULL,
    doctor_id      INT UNSIGNED    NOT NULL,
    clinical_notes TEXT            DEFAULT NULL,
    disposition    ENUM('Admit','Discharge','Refer','Observe') NOT NULL,
    assessed_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (assessment_id),
    CONSTRAINT fk_doctor_assessments_diagnosis
        FOREIGN KEY (diagnosis_id) REFERENCES diagnoses (diagnosis_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_doctor_assessments_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors (doctor_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
