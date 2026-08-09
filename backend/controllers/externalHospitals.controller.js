const db = require('../config/db');

// ── External hospital directory ──────────────────────────────────────────────
// The facilities this hospital diverts patients to when it is at capacity.
// Admins maintain the list; doctors/nurses read it to fill the external
// referral form. Referrals snapshot the name/contact/address they used, so
// editing an entry here never rewrites a past transfer (see
// referrals.controller.createExternalReferral).

// GET /api/external-hospitals
// Returns the active directory by default. `?include_inactive=true` adds
// retired entries — the admin management screen needs to see and revive them.
const getAllExternalHospitals = async (req, res) => {
  const includeInactive =
    req.user.role === 'admin' &&
    ['true', '1'].includes(String(req.query.include_inactive));

  try {
    const [rows] = await db.query(
      `SELECT h.hospital_id, h.name, h.contact_number, h.address, h.is_active,
              COUNT(r.referral_id) AS referral_count
       FROM external_hospitals h
       LEFT JOIN referrals r ON r.external_hospital_id = h.hospital_id
       ${includeInactive ? '' : 'WHERE h.is_active = 1'}
       GROUP BY h.hospital_id
       ORDER BY h.is_active DESC, h.name`
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error('getAllExternalHospitals error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Shared field validation for create/update. Returns an error string, or null.
const validate = ({ name, contact_number, address }, { nameRequired }) => {
  if (nameRequired || name !== undefined) {
    if (!name || !String(name).trim()) return 'Hospital name is required.';
    if (String(name).trim().length > 200) return 'Hospital name must be 200 characters or fewer.';
  }
  if (contact_number && String(contact_number).trim().length > 50) {
    return 'Contact number must be 50 characters or fewer.';
  }
  if (address && String(address).trim().length > 255) {
    return 'Address must be 255 characters or fewer.';
  }
  return null;
};

// POST /api/external-hospitals  — admin only
const createExternalHospital = async (req, res) => {
  const { name, contact_number, address } = req.body;

  const invalid = validate(req.body, { nameRequired: true });
  if (invalid) return res.status(400).json({ success: false, message: invalid });

  try {
    const [result] = await db.query(
      'INSERT INTO external_hospitals (name, contact_number, address) VALUES (?, ?, ?)',
      [String(name).trim(), contact_number?.trim() || null, address?.trim() || null]
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'CREATE', 'external_hospitals', ?)",
      [req.user.user_id, result.insertId]
    );

    return res.status(201).json({ success: true, message: 'Hospital added.', hospital_id: result.insertId });
  } catch (err) {
    // uq_external_hospital_name — the duplicate this table exists to prevent.
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A hospital with this name already exists.' });
    }
    console.error('createExternalHospital error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PUT /api/external-hospitals/:id  — admin only
// Also the retire/revive switch, via is_active.
const updateExternalHospital = async (req, res) => {
  const { name, contact_number, address, is_active } = req.body;

  const invalid = validate(req.body, { nameRequired: false });
  if (invalid) return res.status(400).json({ success: false, message: invalid });

  if (is_active !== undefined && ![0, 1, '0', '1', true, false].includes(is_active)) {
    return res.status(400).json({ success: false, message: 'is_active must be 0 or 1.' });
  }

  try {
    const [[hospital]] = await db.query(
      'SELECT hospital_id FROM external_hospitals WHERE hospital_id = ?',
      [req.params.id]
    );
    if (!hospital) {
      return res.status(404).json({ success: false, message: 'Hospital not found.' });
    }

    // Only the fields actually sent are written. COALESCE(?, col) would be
    // shorter but could not clear a field: an admin blanking a wrong phone
    // number would silently keep the old one.
    const sets = [];
    const params = [];
    if (name !== undefined)           { sets.push('name = ?');           params.push(String(name).trim()); }
    if (contact_number !== undefined) { sets.push('contact_number = ?'); params.push(contact_number?.trim() || null); }
    if (address !== undefined)        { sets.push('address = ?');        params.push(address?.trim() || null); }
    if (is_active !== undefined)      { sets.push('is_active = ?');      params.push(is_active === true || ['1', 1].includes(is_active) ? 1 : 0); }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    params.push(req.params.id);
    await db.query(
      `UPDATE external_hospitals SET ${sets.join(', ')} WHERE hospital_id = ?`,
      params
    );

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'UPDATE', 'external_hospitals', ?)",
      [req.user.user_id, req.params.id]
    );

    return res.status(200).json({ success: true, message: 'Hospital updated.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A hospital with this name already exists.' });
    }
    console.error('updateExternalHospital error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// DELETE /api/external-hospitals/:id  — admin only
// Only ever removes an entry nothing points at. Once a patient has been sent
// somewhere, that destination is part of the record: the admin is told to
// retire it (is_active = 0) instead, which hides it from the form and keeps
// every past referral intact. Mirrors deleteRoom's "has history" refusal.
const deleteExternalHospital = async (req, res) => {
  try {
    const [[hospital]] = await db.query(
      'SELECT hospital_id, name FROM external_hospitals WHERE hospital_id = ?',
      [req.params.id]
    );
    if (!hospital) {
      return res.status(404).json({ success: false, message: 'Hospital not found.' });
    }

    const [[used]] = await db.query(
      'SELECT COUNT(*) AS cnt FROM referrals WHERE external_hospital_id = ?',
      [req.params.id]
    );
    if (used.cnt > 0) {
      return res.status(409).json({
        success: false,
        message: `${hospital.name} has ${used.cnt} referral${used.cnt === 1 ? '' : 's'} on record and cannot be deleted. Deactivate it instead to hide it from the referral form.`,
      });
    }

    await db.query('DELETE FROM external_hospitals WHERE hospital_id = ?', [req.params.id]);

    await db.query(
      "INSERT INTO activity_logs (user_id, action, target_table, target_id) VALUES (?, 'DELETE', 'external_hospitals', ?)",
      [req.user.user_id, req.params.id]
    );

    return res.status(200).json({ success: true, message: 'Hospital deleted.' });
  } catch (err) {
    console.error('deleteExternalHospital error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  getAllExternalHospitals,
  createExternalHospital,
  updateExternalHospital,
  deleteExternalHospital,
};
