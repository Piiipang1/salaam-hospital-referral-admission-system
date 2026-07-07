const db = require('../config/db');

// Fresh DB read per check — Doctor-in-Charge is toggled by admins at runtime
// and JWTs live 8h, so the flag must never be trusted from the token.
const isDoctorInCharge = async (user_id) => {
  const [[row]] = await db.query(
    'SELECT is_doctor_in_charge FROM users WHERE user_id = ? AND is_active = 1',
    [user_id]
  );
  return !!row?.is_doctor_in_charge;
};

module.exports = { isDoctorInCharge };
