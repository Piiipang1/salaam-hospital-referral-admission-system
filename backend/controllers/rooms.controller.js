const db = require('../config/db');

// GET /api/rooms
const getAllRooms = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         r.*,
         a.admission_id,
         a.admission_type,
         a.admission_date,
         CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
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
         ) AS triage_level
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
    const [result] = await db.query(
      "INSERT INTO rooms (room_type, bed_number, availability_status) VALUES (?, ?, 'available')",
      [room_type, bed_number]
    );
    return res.status(201).json({ success: true, message: 'Room added.', room_id: result.insertId });
  } catch (err) {
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

module.exports = { getAllRooms, getAvailableRooms, getRoomById, createRoom, updateRoom, deleteRoom };
