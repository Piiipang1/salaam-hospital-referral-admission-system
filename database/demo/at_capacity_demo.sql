-- =============================================================================
-- DEMO: "No Rooms available" capacity lock
--
-- Forces the hospital to zero available beds so the capacity feature can be
-- shown live, then puts the data back exactly as it was.
--
-- WHAT THIS DEMONSTRATES
--   With 0 available beds the API refuses, with HTTP 409, every intake write:
--     * POST /api/patients            (register a patient)
--     * POST /api/triages             (record a triage)
--     * POST /api/admissions          (admit a patient)
--   and the UI shows the amber banner, greys out those buttons, and reveals
--   "Refer to External Hospital" as the action that IS still possible.
--
-- HOW TO RUN (phpMyAdmin → SQL tab, or the mysql client)
--   Run ONE STEP AT A TIME. Do not paste the whole file at once — steps 2 and 4
--   are opposites, and running them together would undo the demo instantly.
--
--   STEP 1  before  — show the starting capacity
--   STEP 2  trigger — occupy every bed        ← the demo starts here
--   STEP 3  verify  — prove at_capacity = 1
--   ... demo the app in the browser ...
--   STEP 4  restore — put the beds back
--   STEP 5  confirm — prove the data is as it was
--
-- The frontend polls capacity every 15 seconds, so after STEP 2 the banner
-- appears on its own — no page refresh needed in front of the panel.
-- =============================================================================

USE salaam_hospital;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — BEFORE: the starting position
-- Run this first and note the numbers, so you can prove STEP 5 restored them.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                              AS total_rooms,
  COALESCE(SUM(availability_status = 'available'), 0)    AS available_rooms,
  COUNT(*) - COALESCE(SUM(availability_status = 'available'), 0) AS occupied_rooms,
  CASE WHEN COALESCE(SUM(availability_status = 'available'), 0) = 0
       THEN 'YES — intake is blocked'
       ELSE 'no  — intake is open'
  END                                                   AS at_capacity
FROM rooms;


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — TRIGGER: occupy every bed
--
-- This is the whole demo. The backend decides "at capacity" purely from
-- rooms.availability_status (see backend/utils/capacity.js getRoomCapacity),
-- so setting them all to 'occupied' is exactly the real condition, not a fake
-- flag. Beds already occupied are left alone.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE rooms
   SET availability_status = 'occupied'
 WHERE availability_status = 'available';


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY: at_capacity is now true
--
-- This is the SAME expression the API computes and returns from
-- GET /api/rooms/capacity, so what you see here is what the app sees.
-- Expect: available_rooms = 0, at_capacity = 'YES'.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                           AS total_rooms,
  COALESCE(SUM(availability_status = 'available'), 0) AS available_rooms,
  CASE WHEN COALESCE(SUM(availability_status = 'available'), 0) = 0
       THEN 'YES — intake is blocked'
       ELSE 'no  — intake is open'
  END                                                AS at_capacity
FROM rooms;

-- ── Now, in the browser, show any of these ──────────────────────────────────
--   Nurse → Patients    : amber banner, "+ Register Patient" greyed out,
--                         "Refer to External Hospital" button appears
--   Nurse → Triage      : "+ Record Triage" greyed out
--   Doctor → My Patients: "+ Admit Patient" greyed out
--   Any role            : GET /api/rooms/capacity returns at_capacity: true
-- Attempting any of those writes anyway returns HTTP 409 with the message
-- "No Rooms available. Patient registration, admission, and triaging are
--  temporarily disabled."
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — RESTORE: free only the beds that are genuinely empty
--
-- IMPORTANT: do NOT use a blanket "SET availability_status = 'available'".
-- That would also free the beds that currently hold a patient, leaving the
-- room grid claiming a bed is empty while an admission still points at it —
-- and the next admission would put a second patient in an occupied bed.
--
-- This frees a bed only when NO ongoing admission references it. The three
-- ongoing statuses match OCCUPYING plus 'Pending Room' (see
-- backend/controllers/rooms.controller.js updateRoom, which applies the same
-- rule when an admin frees a room by hand).
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE rooms r
   SET r.availability_status = 'available'
 WHERE NOT EXISTS (
         SELECT 1
           FROM admissions a
          WHERE a.room_id = r.room_id
            AND a.status IN ('Pending Room', 'Active', 'Pending Discharge')
       );


-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5 — CONFIRM: back to the STEP 1 numbers
--
-- occupied_rooms should equal beds_with_a_patient. If they differ, some bed is
-- flagged occupied without an admission behind it (or the reverse) — the
-- mismatch query below lists exactly which.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                                      AS total_rooms,
  COALESCE(SUM(availability_status = 'available'), 0)            AS available_rooms,
  COUNT(*) - COALESCE(SUM(availability_status = 'available'), 0) AS occupied_rooms,
  (SELECT COUNT(DISTINCT a.room_id) FROM admissions a
    WHERE a.room_id IS NOT NULL
      AND a.status IN ('Pending Room', 'Active', 'Pending Discharge')) AS beds_with_a_patient
FROM rooms;

-- Any bed whose flag disagrees with its admissions. Expect zero rows.
SELECT r.room_id, r.room_type, r.bed_number, r.availability_status,
       CASE WHEN r.availability_status = 'occupied'
            THEN 'flagged occupied but no ongoing admission'
            ELSE 'flagged available but a patient is in it'
       END AS problem
  FROM rooms r
 WHERE r.availability_status = 'occupied'
       <> EXISTS (SELECT 1 FROM admissions a
                   WHERE a.room_id = r.room_id
                     AND a.status IN ('Pending Room', 'Active', 'Pending Discharge'));
