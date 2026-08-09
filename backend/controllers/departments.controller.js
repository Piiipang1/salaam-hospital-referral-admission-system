const db = require('../config/db');

// ── Departments (wards) ──────────────────────────────────────────────────────
// The wards a nurse can belong to and a room can sit in. Reading is open to any
// authenticated user (names and counts only, no clinical data); writing is
// admin-only, like rooms.

// GET /api/departments
// `?include_inactive=true` (admin only) adds retired wards — the management
// screen needs to see and revive them.
const getAllDepartments = async (req, res) => {
  const includeInactive =
    req.user.role === 'admin' &&
    ['true', '1'].includes(String(req.query.include_inactive));

  try {
    const [rows] = await db.query(
      `SELECT d.department_id, d.name, d.description, d.is_active,
              (SELECT COUNT(*) FROM rooms r     WHERE r.department_id = d.department_id) AS room_count,
              (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.department_id
                                                  AND e.employment_status = 'Active') AS nurse_count
       FROM departments d
       ${includeInactive ? '' : 'WHERE d.is_active = 1'}
       ORDER BY d.is_active DESC, d.name`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getAllDepartments error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/departments — admin only
const createDepartment = async (req, res) => {
  const { name, description } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, message: 'Department name is required.' });
  }
  if (String(name).trim().length > 100) {
    return res.status(400).json({ success: false, message: 'Department name must be 100 characters or fewer.' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO departments (name, description) VALUES (?, ?)',
      [String(name).trim(), description?.trim() || null]
    );
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'departments', ?)",
      [req.user.user_id, result.insertId]
    );
    return res.status(201).json({ success: true, message: 'Department added.', department_id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A department with this name already exists.' });
    }
    console.error('createDepartment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/departments/:id — admin only (also the retire/revive switch)
const updateDepartment = async (req, res) => {
  const { name, description, is_active } = req.body;

  if (name !== undefined && (!name || !String(name).trim())) {
    return res.status(400).json({ success: false, message: 'Department name cannot be empty.' });
  }

  try {
    const [[dept]] = await db.query('SELECT department_id FROM departments WHERE department_id = ?', [req.params.id]);
    if (!dept) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    // Only the fields actually sent are written, so a blank description can be
    // cleared rather than silently kept (same reasoning as external hospitals).
    const sets = [];
    const params = [];
    if (name !== undefined)        { sets.push('name = ?');        params.push(String(name).trim()); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description?.trim() || null); }
    if (is_active !== undefined)   { sets.push('is_active = ?');   params.push(is_active === true || ['1', 1].includes(is_active) ? 1 : 0); }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    params.push(req.params.id);
    await db.query(`UPDATE departments SET ${sets.join(', ')} WHERE department_id = ?`, params);

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'departments', ?)",
      [req.user.user_id, req.params.id]
    );
    return res.status(200).json({ success: true, message: 'Department updated.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A department with this name already exists.' });
    }
    console.error('updateDepartment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/departments/nurses/:employeeId — admin only
// Assign (or clear, with department_id null) a nurse's ward. Kept on this
// router rather than /api/employees because the department IS the resource
// being administered here.
const setEmployeeDepartment = async (req, res) => {
  const { department_id } = req.body;

  try {
    const [[employee]] = await db.query(
      'SELECT employee_id, role FROM employees WHERE employee_id = ?',
      [req.params.employeeId]
    );
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    let deptId = null;
    if (department_id !== null && department_id !== undefined && department_id !== '') {
      const [[dept]] = await db.query(
        'SELECT department_id, is_active FROM departments WHERE department_id = ?',
        [department_id]
      );
      if (!dept) {
        return res.status(400).json({ success: false, message: 'Department not found.' });
      }
      // A retired ward has no roster to join.
      if (!dept.is_active) {
        return res.status(409).json({ success: false, message: 'That department is retired. Reactivate it first.' });
      }
      deptId = dept.department_id;
    }

    await db.query('UPDATE employees SET department_id = ? WHERE employee_id = ?', [deptId, employee.employee_id]);
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'SET_DEPARTMENT', 'employees', ?)",
      [req.user.user_id, employee.employee_id]
    );

    return res.status(200).json({
      success: true,
      message: deptId ? 'Department assigned.' : 'Department cleared.',
    });
  } catch (err) {
    console.error('setEmployeeDepartment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/departments/:id — admin only.
// Only removes a ward nothing references. Once rooms or employees point at it,
// admin is told to retire it instead — same rule as rooms and external
// hospitals, so history is never silently rewritten.
const deleteDepartment = async (req, res) => {
  try {
    const [[dept]] = await db.query('SELECT department_id, name FROM departments WHERE department_id = ?', [req.params.id]);
    if (!dept) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    const [[refs]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM rooms       WHERE department_id = ?) AS rooms,
              (SELECT COUNT(*) FROM employees   WHERE department_id = ?) AS employees,
              (SELECT COUNT(*) FROM endorsements WHERE department_id = ?) AS endorsements`,
      [req.params.id, req.params.id, req.params.id]
    );
    const total = refs.rooms + refs.employees + refs.endorsements;
    if (total > 0) {
      return res.status(409).json({
        success: false,
        message: `${dept.name} is still referenced by ${refs.rooms} room(s), ${refs.employees} employee(s) and ${refs.endorsements} endorsement(s). Deactivate it instead.`,
      });
    }

    await db.query('DELETE FROM departments WHERE department_id = ?', [req.params.id]);
    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'DELETE', 'departments', ?)",
      [req.user.user_id, req.params.id]
    );
    return res.status(200).json({ success: true, message: 'Department deleted.' });
  } catch (err) {
    console.error('deleteDepartment error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  getAllDepartments,
  createDepartment,
  updateDepartment,
  setEmployeeDepartment,
  deleteDepartment,
};
