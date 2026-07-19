const mysql = require('mysql2');
// Env vars are loaded once by server.js (the only entry point) before this
// module is required — no dotenv.config() here.

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Return DATE columns (date_of_birth, diagnosis_date) as plain 'YYYY-MM-DD'
    // strings instead of JS Date objects — a Date JSON-serializes as a UTC-shifted
    // ISO string, which shifts the day by one in UTC+ timezones. DATETIME/TIMESTAMP
    // are unaffected and keep their default (Date object) handling.
    dateStrings: ['DATE'],
    ...(process.env.DB_SSL === 'true' && { ssl: { rejectUnauthorized: false } }),
});

const promisePool = pool.promise();

// Test connection on startup
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ MySQL connection failed:', err.message);
        return;
    }
    console.log('✅ MySQL connected successfully');
    connection.release();
});

module.exports = promisePool;
