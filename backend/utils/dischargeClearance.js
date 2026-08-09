const db = require('../config/db');

// ── Pre-discharge clearance checklist ────────────────────────────────────────
// A patient may not be discharged until all three items are verified. The list
// and its rules live here so the enforcement in confirmDischarge and the
// clearance endpoints can never drift apart.

const CLEARANCE_ITEMS = ['Billing', 'Administrative', 'DoctorOrder'];

// What the user sees. Keep in sync with CLEARANCE_LABELS in the frontend.
const ITEM_LABELS = {
  Billing:        'Billing clearance',
  Administrative: 'Administrative clearance',
  DoctorOrder:    "Doctor's discharge order",
};

// DoctorOrder is not a nurse's to assert — it is written automatically when the
// assigned doctor initiates the discharge. Only a doctor may set it by hand
// (e.g. recording a paper order); nurses tick the other two.
const ITEM_ROLES = {
  Billing:        ['nurse'],
  Administrative: ['nurse'],
  DoctorOrder:    ['doctor'],
};

const isValidItem = (item) => CLEARANCE_ITEMS.includes(item);

// Full checklist for an admission: every item, verified or not, in a fixed
// order so the UI never has to sort it.
const getClearanceState = async (admissionId, executor = db) => {
  const [rows] = await executor.query(
    `SELECT ci.item, ci.verified_at, ci.notes, ci.verified_by,
            COALESCE(
              CONCAT(doc.first_name, ' ', doc.last_name),
              CONCAT(emp.first_name, ' ', emp.last_name),
              u.username
            ) AS verified_by_name,
            u.role AS verified_by_role
     FROM discharge_clearance_items ci
     LEFT JOIN users u     ON u.user_id = ci.verified_by
     LEFT JOIN doctors doc ON u.role = 'doctor' AND doc.doctor_id = u.linked_id
     LEFT JOIN employees emp ON u.role = 'nurse' AND emp.employee_id = u.linked_id
     WHERE ci.admission_id = ?`,
    [admissionId]
  );

  const byItem = Object.fromEntries(rows.map((r) => [r.item, r]));
  const items = CLEARANCE_ITEMS.map((item) => ({
    item,
    label:    ITEM_LABELS[item],
    verified: !!byItem[item],
    verified_at:      byItem[item]?.verified_at ?? null,
    verified_by_name: byItem[item]?.verified_by_name ?? null,
    verified_by_role: byItem[item]?.verified_by_role ?? null,
    notes:            byItem[item]?.notes ?? null,
    // Told to the client so it can render this row read-only rather than
    // offering a tick the API would refuse.
    verifiable_by: ITEM_ROLES[item],
  }));

  const missing = items.filter((i) => !i.verified).map((i) => i.item);
  return {
    items,
    missing,
    complete: missing.length === 0,
    cleared_count: items.length - missing.length,
    total_count: items.length,
  };
};

// Guard for confirmDischarge. Reads on the caller's connection so it can run
// inside the discharge transaction and see a tick committed moments earlier.
// Returns null when clear, or { status, message } to send back.
const blockIfNotCleared = async (admissionId, executor = db) => {
  const state = await getClearanceState(admissionId, executor);
  if (state.complete) return null;
  const missingLabels = state.missing.map((i) => ITEM_LABELS[i]).join(', ');
  return {
    status: 409,
    message: `Discharge blocked — outstanding clearance: ${missingLabels}.`,
    missing: state.missing,
  };
};

module.exports = {
  CLEARANCE_ITEMS,
  ITEM_LABELS,
  ITEM_ROLES,
  isValidItem,
  getClearanceState,
  blockIfNotCleared,
};
