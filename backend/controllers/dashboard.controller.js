const db = require('../config/db');

// GET /api/dashboard/stats
const getStats = async (req, res) => {
  // Hospital-wide totals are not for doctors — they get /my-stats instead.
  if (req.user.role === 'doctor') {
    return res.status(403).json({ success: false, message: 'Doctors use /api/dashboard/my-stats.' });
  }
  try {
    const [
      [[{ total_patients }]],
      [[{ active_admissions }]],
      [[{ available_rooms }]],
      [[{ pending_referrals }]],
      [[{ todays_triages }]],
      [[{ total_doctors }]],
    ] = await Promise.all([
      db.query('SELECT COUNT(*) AS total_patients FROM patients'),
      db.query("SELECT COUNT(*) AS active_admissions FROM admissions WHERE status = 'Active'"),
      db.query("SELECT COUNT(*) AS available_rooms FROM rooms WHERE availability_status = 'available'"),
      db.query("SELECT COUNT(*) AS pending_referrals FROM referrals WHERE status = 'Pending'"),
      db.query('SELECT COUNT(*) AS todays_triages FROM triages WHERE DATE(triage_datetime) = CURDATE()'),
      db.query("SELECT COUNT(*) AS total_doctors FROM doctors WHERE employment_status = 'Active'"),
    ]);

    return res.status(200).json({
      success: true,
      data: { total_patients, active_admissions, available_rooms, pending_referrals, todays_triages, total_doctors },
    });
  } catch (err) {
    console.error('getStats error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/dashboard/recent-activity
// Role-scoped: doctors see only their own admissions/referrals (assigned OR
// referring — same OR-scope as referrals.controller getAllReferrals so the
// dashboard and Referrals page always show the same population); nurses see
// activity for patients they personally registered (same activity_logs
// pattern as patients.controller); admin/staff see hospital-wide.
const getRecentActivity = async (req, res) => {
  try {
    // Referrals are clinical — only doctors and admins ever see them. Nurses
    // and staff receive none, matching the referral route/nav restrictions.
    const canSeeReferrals = req.user.role === 'doctor' || req.user.role === 'admin';

    let admissionWhere = '';
    let referralWhere  = '';
    const admissionParams = [];
    const referralParams  = [];

    if (req.user.role === 'doctor') {
      admissionWhere = 'WHERE a.doctor_id = ?';
      admissionParams.push(req.user.linked_id);
      referralWhere = 'WHERE (r.assigned_doctor_id = ? OR r.referring_doctor_id = ?)';
      referralParams.push(req.user.linked_id, req.user.linked_id);
    }

    if (req.user.role === 'nurse') {
      admissionWhere = `WHERE a.patient_id IN (
        SELECT CAST(target_id AS UNSIGNED) FROM activity_logs
        WHERE user_id = ? AND action = 'CREATE' AND target_table = 'patients'
      )`;
      admissionParams.push(req.user.user_id);
    }

    const [admissions, referrals] = await Promise.all([
      db.query(`
        SELECT a.admission_id, a.admission_date, a.status AS admission_status, a.admission_type,
               CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.patient_id,
               CONCAT(d.first_name, ' ', d.last_name) AS doctor_name,
               r.room_type, r.bed_number
        FROM admissions a
        LEFT JOIN patients p ON a.patient_id = p.patient_id
        LEFT JOIN doctors  d ON a.doctor_id  = d.doctor_id
        LEFT JOIN rooms    r ON a.room_id    = r.room_id
        ${admissionWhere}
        ORDER BY a.admission_date DESC LIMIT 5
      `, admissionParams),
      canSeeReferrals
        ? db.query(`
            SELECT r.referral_id, r.referral_date, r.status AS referral_status,
                   CONCAT(p.first_name, ' ', p.last_name)   AS patient_name, p.patient_id,
                   CONCAT(ad.first_name, ' ', ad.last_name) AS assigned_doctor_name,
                   CONCAT(rd.first_name, ' ', rd.last_name) AS referring_doctor_name,
                   diag.medical_condition
            FROM referrals r
            LEFT JOIN diagnoses diag ON r.diagnosis_id       = diag.diagnosis_id
            LEFT JOIN patients  p    ON diag.patient_id      = p.patient_id
            LEFT JOIN doctors   ad   ON r.assigned_doctor_id  = ad.doctor_id
            LEFT JOIN doctors   rd   ON r.referring_doctor_id = rd.doctor_id
            ${referralWhere}
            ORDER BY r.referral_date DESC LIMIT 5
          `, referralParams)
        : Promise.resolve([[]]),
    ]);

    return res.status(200).json({
      success: true,
      data: { recent_admissions: admissions[0], recent_referrals: referrals[0] },
    });
  } catch (err) {
    console.error('getRecentActivity error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/dashboard/my-stats
// Returns role-specific stats + a focused action list for each role.
const getMyStats = async (req, res) => {
  const { role, linked_id } = req.user;

  try {

    // ── Doctor ────────────────────────────────────────────────────────────────
    if (role === 'doctor') {
      const [
        [[{ my_pending_referrals }]],
        [[{ my_active_patients }]],
        [[{ my_todays_diagnoses }]],
        pendingReferralRows,
        todayDiagnosisRows,
      ] = await Promise.all([

        db.query(
          "SELECT COUNT(*) AS my_pending_referrals FROM referrals WHERE assigned_doctor_id = ? AND status = 'Pending'",
          [linked_id]
        ),
        db.query(
          `SELECT COUNT(DISTINCT patient_id) AS my_active_patients
           FROM (
             SELECT patient_id FROM doctor_in_charge WHERE doctor_id = ?
             UNION
             SELECT d.patient_id FROM referrals r
               JOIN diagnoses d ON d.diagnosis_id = r.diagnosis_id
               WHERE r.assigned_doctor_id = ?
             UNION
             SELECT patient_id FROM admissions WHERE doctor_id = ?
           ) AS t`,
          [linked_id, linked_id, linked_id]
        ),
        db.query(
          "SELECT COUNT(*) AS my_todays_diagnoses FROM diagnoses WHERE doctor_id = ? AND DATE(diagnosis_date) = CURDATE()",
          [linked_id]
        ),

        // List: pending referrals assigned to this doctor (up to 8)
        db.query(
          `SELECT r.referral_id, r.referral_date, r.status,
                  CONCAT(p.first_name, ' ', p.last_name)   AS patient_name, p.patient_id,
                  diag.medical_condition,
                  CONCAT(rd.first_name, ' ', rd.last_name) AS referring_doctor_name
           FROM referrals r
           LEFT JOIN diagnoses diag ON r.diagnosis_id       = diag.diagnosis_id
           LEFT JOIN patients  p    ON diag.patient_id      = p.patient_id
           LEFT JOIN doctors   rd   ON r.referring_doctor_id = rd.doctor_id
           WHERE r.assigned_doctor_id = ? AND r.status = 'Pending'
           ORDER BY r.referral_date DESC LIMIT 8`,
          [linked_id]
        ),

        // List: today's diagnoses by this doctor (up to 8)
        db.query(
          `SELECT diag.diagnosis_id, diag.diagnosis_date, diag.medical_condition,
                  CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.patient_id
           FROM diagnoses diag
           LEFT JOIN patients p ON diag.patient_id = p.patient_id
           WHERE diag.doctor_id = ? AND DATE(diag.diagnosis_date) = CURDATE()
           ORDER BY diag.diagnosis_date DESC LIMIT 8`,
          [linked_id]
        ),
      ]);

      return res.status(200).json({
        success: true,
        role: 'doctor',
        data: {
          stats: { my_pending_referrals, my_active_patients, my_todays_diagnoses },
          my_pending_referrals: pendingReferralRows[0],
          my_todays_diagnoses: todayDiagnosisRows[0],
        },
      });
    }

    // ── Nurse / Staff ─────────────────────────────────────────────────────────
    if (role === 'nurse' || role === 'staff') {
      const [
        [[{ todays_triages }]],
        [[{ available_rooms }]],
        [[{ pending_admissions }]],
        todayTriageRows,
        pendingAdmissionRows,
      ] = await Promise.all([

        db.query('SELECT COUNT(*) AS todays_triages FROM triages WHERE DATE(triage_datetime) = CURDATE()'),
        db.query("SELECT COUNT(*) AS available_rooms FROM rooms WHERE availability_status = 'available'"),
        db.query("SELECT COUNT(*) AS pending_admissions FROM admissions WHERE status = 'Active'"),

        // List: today's triages (up to 8, newest first)
        db.query(`
          SELECT t.triage_id, t.triage_datetime, t.triage_level, t.notes,
                 CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.patient_id
          FROM triages t
          LEFT JOIN patients p ON t.patient_id = p.patient_id
          WHERE DATE(t.triage_datetime) = CURDATE()
          ORDER BY t.triage_datetime DESC LIMIT 8
        `),

        // List: pending admissions (up to 8, oldest first so most urgent on top)
        db.query(`
          SELECT a.admission_id, a.admission_date, a.admission_type, a.status,
                 CONCAT(p.first_name, ' ', p.last_name) AS patient_name, p.patient_id,
                 r.room_type, r.bed_number
          FROM admissions a
          LEFT JOIN patients p ON a.patient_id = p.patient_id
          LEFT JOIN rooms    r ON a.room_id    = r.room_id
          WHERE a.status = 'Pending'
          ORDER BY a.admission_date ASC LIMIT 8
        `),
      ]);

      return res.status(200).json({
        success: true,
        role: 'nurse_staff',
        data: {
          stats: { todays_triages, available_rooms, pending_admissions },
          todays_triages: todayTriageRows[0],
          pending_admissions: pendingAdmissionRows[0],
        },
      });
    }

    // ── Admin — global stats (same as /stats) ─────────────────────────────────
    const [
      [[{ total_patients }]],
      [[{ active_admissions }]],
      [[{ available_rooms }]],
      [[{ pending_referrals }]],
      [[{ todays_triages }]],
      [[{ total_doctors }]],
    ] = await Promise.all([
      db.query('SELECT COUNT(*) AS total_patients FROM patients'),
      db.query("SELECT COUNT(*) AS active_admissions FROM admissions WHERE status = 'Active'"),
      db.query("SELECT COUNT(*) AS available_rooms FROM rooms WHERE availability_status = 'available'"),
      db.query("SELECT COUNT(*) AS pending_referrals FROM referrals WHERE status = 'Pending'"),
      db.query('SELECT COUNT(*) AS todays_triages FROM triages WHERE DATE(triage_datetime) = CURDATE()'),
      db.query("SELECT COUNT(*) AS total_doctors FROM doctors WHERE employment_status = 'Active'"),
    ]);

    return res.status(200).json({
      success: true,
      role: 'admin',
      data: {
        stats: { total_patients, active_admissions, available_rooms, pending_referrals, todays_triages, total_doctors },
      },
    });

  } catch (err) {
    console.error('getMyStats error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getStats, getRecentActivity, getMyStats };
