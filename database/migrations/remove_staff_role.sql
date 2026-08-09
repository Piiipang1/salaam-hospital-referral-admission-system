-- =============================================================================
-- Remove the legacy "staff" role
--
-- The system now has three roles: admin, doctor, nurse. Staff had exactly the
-- nurse scope in practice — triage, room assignment, discharge confirmation —
-- so the role carried no distinct permissions, only ambiguity about who was
-- responsible for a patient.
--
-- ORDER MATTERS. The UPDATEs must run BEFORE the ALTERs: MariaDB coerces any
-- value that is no longer in an ENUM to the empty string, so dropping 'staff'
-- while rows still hold it would silently corrupt 15 user accounts and 17
-- employee records rather than failing loudly.
--
-- Existing staff accounts are CONVERTED to nurse, not deleted:
--   * their audit history (activity_logs) stays attributed to a real person;
--   * admissions.discharge_confirmed_by keeps pointing at the account that
--     actually confirmed those discharges;
--   * they can keep working, since the nurse scope is what they already had.
--
-- Usernames are deliberately left alone. Renaming 'staff1' → 'nurse26' would
-- lock people out of an account they still use; the username is a label, and
-- the role column is the thing that carries meaning.
--
-- TAKE A BACKUP FIRST — this is not reversible from within the app.
-- If your database is NOT named salaam_hospital, change the USE line.
-- =============================================================================

USE salaam_hospital;

-- 1. Convert the people ------------------------------------------------------
UPDATE users     SET role = 'nurse' WHERE role = 'staff';
UPDATE employees SET role = 'nurse' WHERE role = 'staff';

-- 2. Guard: refuse to narrow the ENUMs while any row still says 'staff'.
-- Step 1 should have emptied both, but if anything raced it — or this file is
-- run out of order — aborting here is far better than step 3 silently blanking
-- those rows. SIGNAL needs a procedure body, hence the temporary routine.
DROP PROCEDURE IF EXISTS assert_no_staff_rows;
DELIMITER $$
CREATE PROCEDURE assert_no_staff_rows()
BEGIN
  DECLARE leftover INT DEFAULT 0;
  SELECT (SELECT COUNT(*) FROM users     WHERE role = 'staff')
       + (SELECT COUNT(*) FROM employees WHERE role = 'staff')
    INTO leftover;
  IF leftover > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Aborted: rows still have role = staff; narrowing the ENUM would blank them.';
  END IF;
END$$
DELIMITER ;
CALL assert_no_staff_rows();
DROP PROCEDURE assert_no_staff_rows;

-- 3. Narrow the ENUMs --------------------------------------------------------
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','doctor','nurse') NOT NULL;

ALTER TABLE employees
  MODIFY COLUMN role ENUM('nurse','admin') NOT NULL DEFAULT 'nurse';

-- 4. Report ------------------------------------------------------------------
SELECT 'users'     AS table_name, role, COUNT(*) AS rows_ FROM users     GROUP BY role
UNION ALL
SELECT 'employees' AS table_name, role, COUNT(*)          FROM employees GROUP BY role;
