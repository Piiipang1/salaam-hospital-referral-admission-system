const db = require('../config/db');

// GET /api/dashboard/stats
const getStats = async (req, res) => {
  try {
    // Run all six COUNT queries in parallel — no inter-dependency between them
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
      data: {
        total_patients,
        active_admissions,
        available_rooms,
        pending_referrals,
        todays_triages,
        total_doctors,
      },
    });
  } catch (err) {
    console.error('getStats error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { getStats };
