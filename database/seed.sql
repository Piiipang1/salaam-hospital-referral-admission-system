-- =============================================================================
-- Salaam Hospital Referral and Admission System
-- Seed Data — Realistic Test Dataset
-- Run AFTER database/schema.sql
-- =============================================================================
-- LOGIN CREDENTIALS (for testing)
-- ─────────────────────────────────────────────────────────────────────────────
--  Role    │ Username  │ Password    │ Linked To
-- ─────────┼───────────┼─────────────┼─────────────────────────────────────────
--  admin   │ admin     │ admin123    │ —
--  doctor  │ doctor1   │ doctor123   │ Dr. Ahmad Salim (General Medicine)
--  doctor  │ doctor2   │ doctor123   │ Dr. Fatima Hadji (Internal Medicine)
--  doctor  │ doctor3   │ doctor123   │ Dr. Abdullah Maulana (Surgery)
--  nurse   │ nurse1    │ nurse123    │ Aisha Dimaampao
--  nurse   │ nurse2    │ nurse123    │ Mariam Sinolinding
--  nurse   │ nurse3    │ nurse123    │ Hassan Mangudadatu
--  nurse   │ nurse4    │ nurse123    │ Karim Balindong
-- =============================================================================

USE salaam_hospital;

-- =============================================================================
-- TIER 1 — No foreign key dependencies
-- =============================================================================

-- -----------------------------------------------------------------------------
-- doctors (5 — across key specializations needed by controllers)
-- doctor_id: 1=Ahmad Salim, 2=Fatima Hadji, 3=Abdullah Maulana,
--            4=Zainab Pangandaman, 5=Ibrahim Macabuat
-- -----------------------------------------------------------------------------
-- doctor_id 6 and 7 are the headline specialists the referral rules rely on:
-- a referral is only valid when the receiving doctor's specialization differs
-- from the referring doctor's, so the seed must contain specialties that a
-- General/Internal Medicine doctor genuinely cannot cover — heart and eye.
INSERT INTO doctors (first_name, last_name, specialization, contact_details, employment_status) VALUES
('Ahmad',    'Salim',       'General Medicine',    '09171000001', 'Active'),
('Fatima',   'Hadji',       'Internal Medicine',   '09171000002', 'Active'),
('Abdullah', 'Maulana',     'Surgery',             '09171000003', 'Active'),
('Zainab',   'Pangandaman', 'Pediatrics',          '09171000004', 'Active'),
('Ibrahim',  'Macabuat',    'Emergency Medicine',  '09171000005', 'Active'),
('Nur-Aina', 'Balindong',   'Cardiology',          '09171000101', 'Active'),
('Yusuf',    'Macapaar',    'Ophthalmology',       '09171000102', 'Active');


-- -----------------------------------------------------------------------------
-- employees (5 — nurses linked to user accounts)
-- employee_id: 1=Aisha, 2=Hassan, 3=Mariam, 4=Karim, 5=Sittie
-- -----------------------------------------------------------------------------
INSERT INTO employees (first_name, last_name, role, contact_details, employment_status) VALUES
('Aisha',   'Dimaampao',   'nurse', '09181000001', 'Active'),
('Hassan',  'Mangudadatu', 'nurse', '09181000002', 'Active'),
('Mariam',  'Sinolinding',  'nurse', '09181000003', 'Active'),
('Karim',   'Balindong',   'nurse', '09181000004', 'Active'),
('Sittie',  'Ampuan',      'nurse', '09181000005', 'Active');


-- -----------------------------------------------------------------------------
-- patients (8 — diverse ages, genders, covering all clinical scenarios)
-- patient_id: 1=Ali Hassan, 2=Sitti Abubakar, 3=Omar Macapaar,
--             4=Khadija Maulana, 5=Abdulrahman Dimaporo,
--             6=Mariam Pangandaman, 7=Ibrahim Balindong, 8=Fatima Abubakar
-- -----------------------------------------------------------------------------
INSERT INTO patients
  (first_name, last_name, sex, date_of_birth, contact_number, address,
   emergency_contact_name, emergency_contact_number)
VALUES
(
  'Ali', 'Hassan', 'Male', '1980-03-15', '09291000001',
  'Brgy. Rosary Heights, Cotabato City',
  'Nadia Hassan', '09291000002'
),
(
  'Sitti', 'Abubakar', 'Female', '1995-07-22', '09291000003',
  'Brgy. Kalanganan, Cotabato City',
  'Samir Abubakar', '09291000004'
),
(
  'Omar', 'Macapaar', 'Male', '1988-11-10', '09291000005',
  'Brgy. Bagua, Cotabato City',
  'Halima Macapaar', '09291000006'
),
(
  'Khadija', 'Maulana', 'Female', '1972-05-30', '09291000007',
  'Brgy. Poblacion, Sultan Kudarat',
  'Alimuddin Maulana', '09291000008'
),
(
  'Abdulrahman', 'Dimaporo', 'Male', '1963-09-05', '09291000009',
  'Brgy. Tamontaka, Cotabato City',
  'Sitti Dimaporo', '09291000010'
),
(
  'Mariam', 'Pangandaman', 'Female', '2001-01-18', '09291000011',
  'Brgy. Bagua II, Cotabato City',
  'Omar Pangandaman', '09291000012'
),
(
  'Ibrahim', 'Balindong', 'Male', '2005-06-12', '09291000013',
  'Brgy. Capiton, Cotabato City',
  'Sohara Balindong', '09291000014'
),
(
  'Fatima', 'Abubakar', 'Female', '1990-12-28', '09291000015',
  'Brgy. Mother Bagobo, Cotabato City',
  'Khalil Abubakar', '09291000016'
);


-- -----------------------------------------------------------------------------
-- rooms (10 — varied types; availability updated after admissions)
-- room_id: 1=GW-01, 2=GW-02, 3=GW-03, 4=GW-04,
--           5=PR-01, 6=PR-02, 7=ICU-01, 8=ICU-02, 9=PW-01, 10=ER-01
-- -----------------------------------------------------------------------------
INSERT INTO rooms (room_type, bed_number, availability_status) VALUES
('General Ward',  'GW-01',  'available'),
('General Ward',  'GW-02',  'available'),
('General Ward',  'GW-03',  'available'),
('General Ward',  'GW-04',  'available'),
('Private Room',  'PR-01',  'available'),
('Private Room',  'PR-02',  'available'),
('ICU',           'ICU-01', 'available'),
('ICU',           'ICU-02', 'available'),
('Pediatric Ward','PW-01',  'available'),
('Emergency Room','ER-01',  'available');


-- -----------------------------------------------------------------------------
-- users (8 — one per role type; bcrypt hashes verified with bcryptjs@3.0.3)
-- user_id: 1=admin, 2=doctor1, 3=doctor2, 4=doctor3,
--           5=nurse1, 6=nurse2, 7=nurse3, 8=nurse4
-- -----------------------------------------------------------------------------
INSERT INTO users (username, password_hash, role, linked_id, is_active) VALUES
(
  'admin',
  '$2b$10$donpG2uJGhw6H9UTtxqY8O86fPBaWtSn10ua.ZrDKGWBXCzuNW.fy',
  -- plaintext: admin123
  'admin', NULL, 1
),
(
  'doctor1',
  '$2b$10$QHnXJlX52blgSMQdJzZOLOTCr0EfPZFqd9vCJ3OEAEjI0v/3/b922',
  -- plaintext: doctor123 | linked to doctor_id=1 (Ahmad Salim)
  'doctor', 1, 1
),
(
  'doctor2',
  '$2b$10$QHnXJlX52blgSMQdJzZOLOTCr0EfPZFqd9vCJ3OEAEjI0v/3/b922',
  -- plaintext: doctor123 | linked to doctor_id=2 (Fatima Hadji)
  'doctor', 2, 1
),
(
  'doctor3',
  '$2b$10$QHnXJlX52blgSMQdJzZOLOTCr0EfPZFqd9vCJ3OEAEjI0v/3/b922',
  -- plaintext: doctor123 | linked to doctor_id=3 (Abdullah Maulana)
  'doctor', 3, 1
),
(
  'doctor.cardio',
  '$2b$10$QHnXJlX52blgSMQdJzZOLOTCr0EfPZFqd9vCJ3OEAEjI0v/3/b922',
  -- plaintext: doctor123 | linked to doctor_id=6 (Nur-Aina Balindong, Cardiology)
  -- Headline specialist: referral targets for heart conditions a General or
  -- Internal Medicine doctor cannot treat.
  'doctor', 6, 1
),
(
  'doctor.eye',
  '$2b$10$QHnXJlX52blgSMQdJzZOLOTCr0EfPZFqd9vCJ3OEAEjI0v/3/b922',
  -- plaintext: doctor123 | linked to doctor_id=7 (Yusuf Macapaar, Ophthalmology)
  'doctor', 7, 1
),
(
  'nurse1',
  '$2b$10$S/Rg0VcJzDODJTEJ0qz0FuE3HotxWpplB6ZPyx56S.O52/SHcLr5G',
  -- plaintext: nurse123 | linked to employee_id=1 (Aisha Dimaampao)
  'nurse', 1, 1
),
(
  'nurse2',
  '$2b$10$S/Rg0VcJzDODJTEJ0qz0FuE3HotxWpplB6ZPyx56S.O52/SHcLr5G',
  -- plaintext: nurse123 | linked to employee_id=3 (Mariam Sinolinding)
  'nurse', 3, 1
),
(
  'nurse3',
  '$2b$10$S/Rg0VcJzDODJTEJ0qz0FuE3HotxWpplB6ZPyx56S.O52/SHcLr5G',
  -- plaintext: nurse123 | linked to employee_id=2 (Hassan Mangudadatu)
  'nurse', 2, 1
),
(
  'nurse4',
  '$2b$10$S/Rg0VcJzDODJTEJ0qz0FuE3HotxWpplB6ZPyx56S.O52/SHcLr5G',
  -- plaintext: nurse123 | linked to employee_id=4 (Karim Balindong)
  'nurse', 4, 1
);


-- =============================================================================
-- TIER 2 — visit_rooms → rooms
-- =============================================================================

-- -----------------------------------------------------------------------------
-- visit_rooms (2 — consultation rooms used during triage)
-- visit_room_id: 1=Consultation Room 1, 2=Consultation Room 2
-- room_id=NULL: consultation rooms are not tracked as inpatient rooms
-- -----------------------------------------------------------------------------
INSERT INTO visit_rooms (room_id, room_label) VALUES
(NULL, 'Consultation Room 1'),
(NULL, 'Consultation Room 2');


-- =============================================================================
-- TIER 3 — triages → patients, employees, visit_rooms
-- =============================================================================

-- -----------------------------------------------------------------------------
-- triages (6 clinical scenarios)
-- triage_id: 1=Ali Hassan(Critical), 2=Sitti Abubakar(Urgent),
--             3=Omar Macapaar(Non-Urgent), 4=Khadija Maulana(Urgent),
--             5=Abdulrahman Dimaporo(Critical), 6=Mariam Pangandaman(Urgent)
-- -----------------------------------------------------------------------------
INSERT INTO triages
  (patient_id, employee_id, visit_room_id, triage_level, notes, triage_datetime)
VALUES
(
  1, 1, 1, 'Critical',
  'Patient presents with severe headache, elevated BP 150/90, dizziness. History of hypertension.',
  '2026-06-01 08:30:00'
),
(
  2, 3, 2, 'Urgent',
  'Patient complains of severe right lower quadrant abdominal pain for 12 hours, nausea, fever.',
  '2026-06-03 10:15:00'
),
(
  3, 1, 1, 'Non-Urgent',
  'Patient presents with cough, colds, and mild sore throat for 3 days. No fever.',
  '2026-06-05 14:00:00'
),
(
  4, 5, 2, 'Urgent',
  'Patient with sudden onset vomiting and diarrhea (5 episodes), abdominal cramping, mild dehydration.',
  '2026-06-08 09:00:00'
),
(
  5, 3, 1, 'Critical',
  'Elderly male with high-grade fever 39.2°C, productive cough with yellowish sputum, difficulty breathing.',
  '2026-06-10 07:45:00'
),
(
  6, 1, 2, 'Urgent',
  'Young female fell from stairs, right forearm deformity with swelling and point tenderness. Unable to pronate.',
  '2026-06-12 11:30:00'
);


-- =============================================================================
-- TIER 4 — vital_signs → triages
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vital_signs (one set per triage — reflects clinical scenario)
-- -----------------------------------------------------------------------------
INSERT INTO vital_signs
  (triage_id, blood_pressure, heart_rate, temperature, respiratory_rate, recorded_at)
VALUES
(1, '150/90', 95,  37.8, 20, '2026-06-01 08:35:00'),  -- Ali Hassan (Hypertension crisis)
(2, '118/76', 105, 38.5, 22, '2026-06-03 10:20:00'),  -- Sitti Abubakar (Appendicitis)
(3, '115/75', 80,  37.2, 16, '2026-06-05 14:05:00'),  -- Omar Macapaar (URTI)
(4, '100/65', 100, 38.8, 24, '2026-06-08 09:05:00'),  -- Khadija Maulana (Gastroenteritis)
(5, '90/60',  120, 39.2, 28, '2026-06-10 07:50:00'),  -- Abdulrahman Dimaporo (Pneumonia)
(6, '122/78', 88,  37.0, 18, '2026-06-12 11:35:00');  -- Mariam Pangandaman (Fracture)


-- =============================================================================
-- TIER 5 — diagnoses → patients, triages, doctors
-- =============================================================================

-- -----------------------------------------------------------------------------
-- diagnoses (6 — one per triage scenario, by respective attending doctors)
-- diagnosis_id: 1=Hypertension, 2=Acute Appendicitis, 3=URTI,
--               4=Acute Gastroenteritis, 5=Pneumonia, 6=Closed Fracture
-- -----------------------------------------------------------------------------
INSERT INTO diagnoses
  (patient_id, triage_id, doctor_id, medical_condition, diagnosis_date)
VALUES
(1, 1, 1, 'Hypertensive Urgency — BP 150/90 with symptomatic headache and dizziness. Requires antihypertensive therapy and monitoring.',        '2026-06-01'),
(2, 2, 1, 'Acute Appendicitis — Classic presentation with RLQ pain, rebound tenderness, elevated WBC, and ultrasound confirmation. Surgical referral indicated.', '2026-06-03'),
(3, 3, 2, 'Upper Respiratory Tract Infection (URTI) — Viral etiology, mild symptoms, no antibiotic indication. Symptomatic management sufficient.', '2026-06-05'),
(4, 4, 2, 'Acute Gastroenteritis with Mild Dehydration — Likely bacterial etiology given fever and frequency. Oral rehydration and dietary modification.', '2026-06-08'),
(5, 5, 1, 'Community-Acquired Pneumonia (CAP) — Right lower lobe consolidation on chest X-ray. High-grade fever, productive cough. IV antibiotics required.', '2026-06-10'),
(6, 6, 3, 'Closed Fracture of the Right Distal Radius — Confirmed by X-ray. Reduction and casting performed. No neurovascular compromise.', '2026-06-12');


-- =============================================================================
-- TIER 6 — treatments, lab_results, referrals → diagnoses, doctors
-- =============================================================================

-- -----------------------------------------------------------------------------
-- treatments (5 — linked to diagnoses; diagnosis 6 (fracture) has no meds)
-- -----------------------------------------------------------------------------
INSERT INTO treatments
  (diagnosis_id, prescribed_medications, dosage, frequency, treatment_duration)
VALUES
(1, 'Amlodipine',                    '5mg',    'Once daily',          'Ongoing — follow up in 1 week'),
(2, 'Cefazolin IV (pre-operative)',  '1g',     'Every 8 hours',       'Until surgery'),
(3, 'Paracetamol + Vitamin C',       '500mg',  'Every 6 hours (PRN)', '5 days'),
(4, 'Oral Rehydration Salts (ORS)',  'As tolerated', 'Every hour',    'Until diarrhea resolves'),
(5, 'Co-Amoxiclav (Amoxicillin-Clavulanate)', '875mg', 'Twice daily', '10 days');


-- -----------------------------------------------------------------------------
-- lab_results (3 — for diagnoses with confirmatory tests ordered)
-- -----------------------------------------------------------------------------
INSERT INTO lab_results
  (patient_id, diagnosis_id, test_type, results, file_attachment, date_conducted)
VALUES
(
  1, 1, 'Complete Blood Count (CBC)',
  'WBC: 11.2 x10^9/L (slightly elevated). RBC: 4.8 x10^12/L. Hgb: 140 g/L. Plt: 210 x10^9/L. Differential: Neutrophilia 78%.',
  NULL, '2026-06-01 09:00:00'
),
(
  2, 2, 'Abdominal Ultrasound',
  'Appendix visualized — outer diameter 9mm with periappendiceal fat stranding and free fluid in the right iliac fossa. Findings consistent with acute appendicitis.',
  NULL, '2026-06-03 11:00:00'
),
(
  5, 5, 'Chest X-Ray (PA view)',
  'Opacity noted at the right lower lobe consistent with consolidation. No pleural effusion. Heart size within normal limits. Impression: Right lower lobe pneumonia.',
  NULL, '2026-06-10 08:15:00'
);


-- -----------------------------------------------------------------------------
-- referrals (4 — various statuses to populate the referral dashboard)
-- referral_id: 1=Appendicitis→Surgery(Accepted), 2=Gastroenteritis→IM(Pending),
--              3=Fracture→GeneralMed(Completed), 4=Pneumonia→Emergency(Cancelled)
-- Note: referral_id=4 assigned_doctor_id=5 (Ibrahim Macabuat) has no user account
--       → no notification will be created (handled by referrals.controller)
-- -----------------------------------------------------------------------------
INSERT INTO referrals
  (diagnosis_id, referring_doctor_id, assigned_doctor_id, referral_date, status)
VALUES
(
  2, 1, 3,
  -- Appendicitis: Dr. Ahmad Salim → Dr. Abdullah Maulana (Surgery) — Accepted
  '2026-06-03 12:00:00', 'Accepted'
),
(
  4, 2, 2,
  -- Gastroenteritis: Dr. Fatima Hadji → Dr. Fatima Hadji (Internal Medicine consult) — Pending
  '2026-06-08 11:00:00', 'Pending'
),
(
  6, 3, 1,
  -- Fracture post-op: Dr. Abdullah Maulana → Dr. Ahmad Salim (follow-up) — Completed
  '2026-06-14 09:00:00', 'Completed'
),
(
  5, 1, 5,
  -- Pneumonia: Dr. Ahmad Salim → Dr. Ibrahim Macabuat (Emergency) — Cancelled
  '2026-06-10 10:00:00', 'Cancelled'
);


-- =============================================================================
-- TIER 7 — admissions → patients, diagnoses, doctors, rooms
--           doctor_in_charge → doctors, patients
-- =============================================================================

-- -----------------------------------------------------------------------------
-- admissions (5 — mix of Active and Discharged across room types)
-- Scenario:
--   1. Ali Hassan  → ICU-01     (Active — Hypertension)
--   2. Sitti       → PR-01      (Active — post-op Appendectomy)
--   3. Abdulrahman → PR-02      (Discharged — Pneumonia, 3-day stay)
--   4. Khadija     → GW-01      (Active — Gastroenteritis)
--   5. Mariam      → GW-02      (Discharged — Fracture, 2-day post-reduction)
-- -----------------------------------------------------------------------------
INSERT INTO admissions
  (patient_id, diagnosis_id, doctor_id, room_id, admission_type,
   admission_date, discharge_date, status)
VALUES
(
  1, 1, 1, 7, 'Emergency',
  '2026-06-01 09:30:00', NULL, 'Active'
),
(
  2, 2, 3, 5, 'Surgical',
  '2026-06-03 13:00:00', NULL, 'Active'
),
(
  5, 5, 1, 6, 'Medical',
  '2026-06-10 08:30:00', '2026-06-13 10:00:00', 'Discharged'
),
(
  4, 4, 2, 1, 'Medical',
  '2026-06-08 10:30:00', NULL, 'Active'
),
(
  6, 6, 3, 2, 'Surgical',
  '2026-06-12 13:30:00', '2026-06-14 09:00:00', 'Discharged'
);

-- Reflect Active admissions in room availability
-- Rooms occupied by Active admissions: ICU-01 (7), PR-01 (5), GW-01 (1)
UPDATE rooms SET availability_status = 'occupied' WHERE room_id IN (7, 5, 1);
-- Rooms freed by Discharged admissions remain 'available' (default)


-- -----------------------------------------------------------------------------
-- doctor_in_charge (6 — auto-created alongside each diagnosis)
-- -----------------------------------------------------------------------------
INSERT INTO doctor_in_charge (doctor_id, patient_id, assigned_at) VALUES
(1, 1, '2026-06-01 09:15:00'),  -- Dr. Ahmad Salim ↔ Ali Hassan
(1, 2, '2026-06-03 12:00:00'),  -- Dr. Ahmad Salim ↔ Sitti Abubakar (initial)
(2, 3, '2026-06-05 14:30:00'),  -- Dr. Fatima Hadji ↔ Omar Macapaar
(2, 4, '2026-06-08 09:45:00'),  -- Dr. Fatima Hadji ↔ Khadija Maulana
(1, 5, '2026-06-10 08:15:00'),  -- Dr. Ahmad Salim ↔ Abdulrahman Dimaporo
(3, 6, '2026-06-12 12:00:00');  -- Dr. Abdullah Maulana ↔ Mariam Pangandaman


-- =============================================================================
-- TIER 8 — notifications → users, referrals
-- =============================================================================

-- -----------------------------------------------------------------------------
-- notifications (5 — referral alerts sent to doctor user accounts)
-- Mapping: referral assigned_doctor_id → user with matching linked_id + role='doctor'
--   referral_id=1 → doctor_id=3 → user_id=4 (doctor3 / Abdullah Maulana)
--   referral_id=2 → doctor_id=2 → user_id=3 (doctor2 / Fatima Hadji)
--   referral_id=3 → doctor_id=1 → user_id=2 (doctor1 / Ahmad Salim)
--   referral_id=4 → doctor_id=5 → no user account → no notification (skipped)
-- Extra: system-level notification for admin
-- -----------------------------------------------------------------------------
INSERT INTO notifications (user_id, referral_id, message, is_read, created_at) VALUES
(
  4, 1,
  'You have a new referral assigned to you. Referral ID: 1. Patient: Sitti Abubakar. Condition: Acute Appendicitis.',
  1,  -- is_read=1 (doctor accepted the referral)
  '2026-06-03 12:05:00'
),
(
  3, 2,
  'You have a new referral assigned to you. Referral ID: 2. Patient: Khadija Maulana. Condition: Acute Gastroenteritis.',
  0,  -- is_read=0 (pending, unread)
  '2026-06-08 11:05:00'
),
(
  2, 3,
  'You have a new referral assigned to you. Referral ID: 3. Patient: Mariam Pangandaman. Condition: Closed Fracture of the Right Distal Radius.',
  1,  -- is_read=1 (referral completed)
  '2026-06-14 09:05:00'
),
(
  5, NULL,
  'System notice: New patient Omar Macapaar has been registered and triaged. Please complete the triage assessment.',
  1,  -- is_read=1
  '2026-06-05 14:10:00'
),
(
  1, NULL,
  'Daily summary: 3 active admissions, 1 pending referral, 6 rooms available as of 2026-06-15.',
  0,  -- is_read=0 (unread — for testing notification badge)
  '2026-06-15 06:00:00'
);


-- =============================================================================
-- TIER 9 — activity_logs → users
-- =============================================================================

-- -----------------------------------------------------------------------------
-- activity_logs (15 — sample audit trail covering all action types)
-- action values from controllers: LOGIN, LOGOUT, CREATE, UPDATE,
--                                 UPDATE_STATUS, DEACTIVATE, DISCHARGE
-- -----------------------------------------------------------------------------
INSERT INTO activity_logs (user_id, action, target_table, target_id, created_at) VALUES
(1, 'LOGIN',         'users',      1, '2026-06-01 08:00:00'),  -- admin logged in
(5, 'LOGIN',         'users',      5, '2026-06-01 08:10:00'),  -- nurse1 logged in
(5, 'CREATE',        'patients',   1, '2026-06-01 08:20:00'),  -- nurse1 registered Ali Hassan
(5, 'CREATE',        'triages',    1, '2026-06-01 08:31:00'),  -- nurse1 triaged Ali Hassan
(2, 'LOGIN',         'users',      2, '2026-06-01 09:00:00'),  -- doctor1 logged in
(2, 'CREATE',        'diagnoses',  1, '2026-06-01 09:15:00'),  -- doctor1 diagnosed Ali Hassan
(1, 'CREATE',        'admissions', 1, '2026-06-01 09:31:00'),  -- admin admitted Ali Hassan
(5, 'CREATE',        'patients',   2, '2026-06-03 10:00:00'),  -- nurse1 registered Sitti Abubakar
(5, 'CREATE',        'triages',    2, '2026-06-03 10:16:00'),  -- nurse1 triaged Sitti Abubakar
(2, 'CREATE',        'diagnoses',  2, '2026-06-03 12:01:00'),  -- doctor1 diagnosed Sitti Abubakar
(2, 'CREATE',        'referrals',  1, '2026-06-03 12:05:00'),  -- doctor1 created referral
(4, 'UPDATE_STATUS', 'referrals',  1, '2026-06-03 12:30:00'),  -- doctor3 accepted referral
(1, 'CREATE',        'admissions', 3, '2026-06-10 08:31:00'),  -- admin admitted Abdulrahman
(1, 'DISCHARGE',     'admissions', 3, '2026-06-13 10:01:00'),  -- admin discharged Abdulrahman
(2, 'LOGOUT',        'users',      2, '2026-06-15 17:00:00');  -- doctor1 logged out
