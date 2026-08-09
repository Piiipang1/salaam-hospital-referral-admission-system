const db = require('../config/db');

// ── Hospital bed capacity ────────────────────────────────────────────────────
// Capacity is measured in beds: one `rooms` row is one bed/unit, and
// availability_status is the single source of truth for whether it is free
// (assignRoom claims it, confirmDischarge / updateRoom release it).
//
// When no bed is free the hospital is at capacity and the intake pipeline is
// closed: patient registration, triage and admission all refuse with 409 and
// the shared message below — the same text the frontend shows as a banner.

const AT_CAPACITY_MESSAGE =
  'No Rooms available. Patient registration, admission, and triaging are temporarily disabled.';

// `executor` accepts a pooled connection so a caller already inside a
// transaction can read capacity on that same connection; defaults to the pool.
const getRoomCapacity = async (executor = db) => {
  const [[row]] = await executor.query(
    `SELECT COUNT(*) AS total_rooms,
            COALESCE(SUM(availability_status = 'available'), 0) AS available_rooms
     FROM rooms`
  );
  const total_rooms     = Number(row.total_rooms);
  const available_rooms = Number(row.available_rooms);
  return {
    total_rooms,
    available_rooms,
    occupied_rooms: total_rooms - available_rooms,
    at_capacity: available_rooms === 0,
  };
};

// Guard shared by every intake write. Sends the 409 and returns true when the
// hospital has no free bed, so callers read as:
//   if (await rejectIfAtCapacity(res)) return;
const rejectIfAtCapacity = async (res) => {
  const capacity = await getRoomCapacity();
  if (!capacity.at_capacity) return false;
  res.status(409).json({ success: false, message: AT_CAPACITY_MESSAGE, at_capacity: true });
  return true;
};

module.exports = { getRoomCapacity, rejectIfAtCapacity, AT_CAPACITY_MESSAGE };
