const db = require('../config/db');

// ── Shared nursing helpers ───────────────────────────────────────────────────
// Nurses are linked to `employees`, not `doctors`, so req.user.linked_id is an
// employee_id. Everything ward-scoped starts by resolving that employee row and
// the department it belongs to.

// Returns { employee_id, first_name, last_name, department_id, department_name }
// or null when the account has no employee record behind it.
const getNurseContext = async (userId, linkedId) => {
  const [[row]] = await db.query(
    `SELECT e.employee_id, e.first_name, e.last_name, e.role, e.department_id,
            d.name AS department_name
     FROM employees e
     LEFT JOIN departments d ON d.department_id = e.department_id
     WHERE e.employee_id = ?`,
    [linkedId]
  );
  return row ?? null;
};

// Guard for every ward-scoped route: sends the response and returns null when
// the caller has no employee record or has not been given a department yet.
// Callers read as:  const nurse = await requireNurseDepartment(req, res); if (!nurse) return;
const requireNurseDepartment = async (req, res) => {
  const nurse = await getNurseContext(req.user.user_id, req.user.linked_id);
  if (!nurse) {
    res.status(403).json({ success: false, message: 'No employee record is linked to this account.' });
    return null;
  }
  if (!nurse.department_id) {
    // Not an error the nurse can fix — say who can.
    res.status(409).json({
      success: false,
      message: 'You have not been assigned to a department yet. Ask an administrator to set your ward under User Management.',
      no_department: true,
    });
    return null;
  }
  return nurse;
};

// Admissions that put a patient physically in a bed right now. 'Pending Room'
// is excluded on purpose: that patient has no room yet, so they belong to no
// ward. Discharged patients are gone.
const OCCUPYING_STATUSES = ['Active', 'Pending Discharge'];

// ── Front-door departments for a returning (discharged) patient ─────────────
// A discharged patient walking back in is a new episode of care, not a
// continuation of their old ward stay — so only a front-door department may
// triage them in. Ward/ICU/Private Room nurses have no reason to be the ones
// re-opening a closed case.
//
// To authorize OPD once it exists: create a department row named exactly
// 'OPD' (or 'Outpatient' — whichever the admin actually creates) and add that
// same string here. Nothing else needs to change; isDischargedTriageDepartment
// reads this list.
const DISCHARGED_TRIAGE_DEPARTMENTS = ['Emergency Room'];

// Case/whitespace-insensitive on purpose: department names are admin-entered
// free text (departments.name), so 'emergency room ' must still match.
const isDischargedTriageDepartment = (departmentName) => {
  if (!departmentName) return false;
  const normalized = String(departmentName).trim().toLowerCase();
  return DISCHARGED_TRIAGE_DEPARTMENTS.some((d) => d.trim().toLowerCase() === normalized);
};

// ── Discharge-order notification routing ─────────────────────────────────────
// A discharge order used to notify EVERY active nurse, which
// made the alert something to dismiss rather than act on. It now goes to the
// nurse actually responsible for the patient.
//
// Three tiers, narrowest first. The tier is returned as `basis` so the caller
// can word the message accordingly and so a fallback is visible in the logs
// rather than looking like normal operation:
//   'assigned' — the nurse holding this patient (nurse_assignments)
//   'ward'     — active nurses in the ward the patient's bed belongs to, used
//                when nobody has claimed the patient
//   'all'      — last resort when the ward has no nurses at all. A discharge
//                nobody is told about would strand the patient, so this stays
//                as a floor rather than sending to nobody.
//
// Returns { userIds: number[], basis, departmentName }.
const resolveDischargeNotificationTargets = async (patientId, roomId, executor = db) => {
  // 1. The nurse personally responsible right now.
  const [assigned] = await executor.query(
    `SELECT u.user_id
     FROM nurse_assignments na
     JOIN users u ON u.linked_id = na.nurse_id AND u.role = 'nurse' AND u.is_active = 1
     WHERE na.patient_id = ? AND na.released_at IS NULL`,
    [patientId]
  );
  if (assigned.length > 0) {
    return { userIds: assigned.map((r) => r.user_id), basis: 'assigned', departmentName: null };
  }

  // 2. Nobody holds this patient — fall back to the ward their bed is in.
  if (roomId) {
    const [wardNurses] = await executor.query(
      `SELECT u.user_id, d.name AS department_name
       FROM rooms r
       JOIN departments d ON d.department_id = r.department_id
       JOIN employees e   ON e.department_id = d.department_id
                         AND e.employment_status = 'Active'
       JOIN users u       ON u.linked_id = e.employee_id AND u.role = 'nurse' AND u.is_active = 1
       WHERE r.room_id = ?`,
      [roomId]
    );
    if (wardNurses.length > 0) {
      return {
        userIds: wardNurses.map((r) => r.user_id),
        basis: 'ward',
        departmentName: wardNurses[0].department_name,
      };
    }
  }

  // 3. Floor: better a wide alert than a discharge nobody is told about.
  const [everyone] = await executor.query(
    "SELECT user_id FROM users WHERE role = 'nurse' AND is_active = 1"
  );
  return { userIds: everyone.map((r) => r.user_id), basis: 'all', departmentName: null };
};

module.exports = {
  getNurseContext,
  requireNurseDepartment,
  OCCUPYING_STATUSES,
  resolveDischargeNotificationTargets,
  DISCHARGED_TRIAGE_DEPARTMENTS,
  isDischargedTriageDepartment,
};
