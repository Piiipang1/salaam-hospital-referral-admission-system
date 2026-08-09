const db = require('../config/db');
const { getRoomCapacity } = require('../utils/capacity');

// GET /api/rooms
const getAllRooms = async (req, res) => {
  try {
    // Admins are oversight-only: they get occupancy + admission metadata for
    // bed planning, but never row-level clinical data (patient name, latest
    // condition, triage level) — same policy as the dashboard and the
    // clinical route guards. Nurses need the patient context to manage
    // beds, so they get the full payload.
    const clinicalColumns = (req.user.role === 'nurse')
      ? `CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
         (
           SELECT d.medical_condition
           FROM diagnoses d
           WHERE d.patient_id = a.patient_id
           ORDER BY d.diagnosis_date DESC
           LIMIT 1
         ) AS patient_condition,
         (
           SELECT t.triage_level
           FROM triages t
           WHERE t.patient_id = a.patient_id
           ORDER BY t.triage_datetime DESC
           LIMIT 1
         ) AS triage_level`
      : `NULL AS patient_name,
         NULL AS patient_condition,
         NULL AS triage_level`;

    const [rows] = await db.query(
      `SELECT
         r.*,
         a.admission_id,
         a.admission_type,
         a.admission_date,
         ${clinicalColumns}
       FROM rooms r
       LEFT JOIN admissions a ON a.room_id = r.room_id AND a.status = 'Active'
       LEFT JOIN patients p ON p.patient_id = a.patient_id
       ORDER BY r.room_type, r.bed_number`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getAllRooms error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/rooms/available
const getAvailableRooms = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM rooms WHERE availability_status = 'available' ORDER BY room_type, bed_number"
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getAvailableRooms error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/rooms/capacity
// Bed-availability summary driving the frontend "no rooms available" banner and
// the disabled intake forms. Open to any authenticated role — it carries counts
// only, no clinical or row-level data.
const getCapacity = async (req, res) => {
  try {
    const capacity = await getRoomCapacity();
    return res.status(200).json({ success: true, data: capacity });
  } catch (err) {
    console.error('getCapacity error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/rooms/:id
const getRoomById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM rooms WHERE room_id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getRoomById error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/rooms
const createRoom = async (req, res) => {
  const { room_type, bed_number } = req.body;

  if (!room_type || !bed_number) {
    return res.status(400).json({ success: false, message: 'room_type and bed_number are required.' });
  }

  try {
    // Reject a duplicate (room_type, bed_number) with a clear 409 rather than a
    // generic 500. The DB also enforces this via the uq_room_bed unique key —
    // the ER_DUP_ENTRY catch below covers the race between this check and INSERT.
    const [[dup]] = await db.query(
      'SELECT room_id FROM rooms WHERE room_type = ? AND bed_number = ?',
      [room_type, bed_number]
    );
    if (dup) {
      return res.status(409).json({ success: false, message: 'A room with this type and bed number already exists.' });
    }

    const [result] = await db.query(
      "INSERT INTO rooms (room_type, bed_number, availability_status) VALUES (?, ?, 'available')",
      [room_type, bed_number]
    );
    return res.status(201).json({ success: true, message: 'Room added.', room_id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A room with this type and bed number already exists.' });
    }
    console.error('createRoom error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/rooms/:id
const updateRoom = async (req, res) => {
  const { room_type, bed_number, availability_status } = req.body;
  const validStatuses = ['available', 'occupied'];

  if (availability_status && !validStatuses.includes(availability_status)) {
    return res.status(400).json({ success: false, message: 'availability_status must be available or occupied.' });
  }

  try {
    // Don't free a bed that still has an ongoing admission — otherwise assignRoom
    // would place a second patient in the same bed. (Same ongoing-admission check
    // deleteRoom uses.) Marking a room 'occupied' manually is always allowed.
    if (availability_status === 'available') {
      const [[ongoing]] = await db.query(
        `SELECT COUNT(*) AS cnt FROM admissions
         WHERE room_id = ? AND status IN ('Pending Room', 'Active')`,
        [req.params.id]
      );
      if (ongoing.cnt > 0) {
        return res.status(409).json({ success: false, message: 'Cannot mark this room available while an admission is using it.' });
      }
    }

    await db.query(
      `UPDATE rooms SET
        room_type = COALESCE(?, room_type),
        bed_number = COALESCE(?, bed_number),
        availability_status = COALESCE(?, availability_status)
       WHERE room_id = ?`,
      [room_type, bed_number, availability_status, req.params.id]
    );
    return res.status(200).json({ success: true, message: 'Room updated.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A room with this type and bed number already exists.' });
    }
    console.error('updateRoom error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/rooms/:id  — admin only
const deleteRoom = async (req, res) => {
  try {
    const [[room]] = await db.query('SELECT * FROM rooms WHERE room_id = ?', [req.params.id]);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    // Refuse while the room is in use — occupied flag or any ongoing admission
    const [[ongoing]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM admissions
       WHERE room_id = ? AND status IN ('Pending Room', 'Active')`,
      [req.params.id]
    );
    if (room.availability_status === 'occupied' || ongoing.cnt > 0) {
      return res.status(409).json({ success: false, message: 'Cannot delete a room that is currently occupied.' });
    }

    try {
      await db.query('DELETE FROM rooms WHERE room_id = ?', [req.params.id]);
    } catch (err) {
      // admissions.room_id → rooms is ON DELETE RESTRICT: rooms referenced by
      // historical (Discharged) admissions must be kept for record integrity.
      if (err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({ success: false, message: 'This room has admission history and cannot be deleted.' });
      }
      throw err;
    }

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'DELETE', 'rooms', ?)",
      [req.user.user_id, req.params.id]
    );

    return res.status(200).json({ success: true, message: 'Room deleted.' });
  } catch (err) {
    console.error('deleteRoom error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getAllRooms, getAvailableRooms, getCapacity, getRoomById, createRoom, updateRoom, deleteRoom };
