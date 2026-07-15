const express = require('express');
const cors = require('cors');
const path = require('path');
// Single source of truth for env vars: backend/.env. Loaded here, before any
// module that reads process.env is required, so no other file needs its own
// dotenv.config(). Absolute path keeps `node backend/server.js` and
// `cd backend && node server.js` identical regardless of CWD.
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ─── Route Imports ────────────────────────────────────────────────────────────
const authRoutes          = require('./routes/auth.routes');
const usersRoutes         = require('./routes/users.routes');
const patientsRoutes      = require('./routes/patients.routes');
const triagesRoutes       = require('./routes/triages.routes');
const diagnosesRoutes     = require('./routes/diagnoses.routes');
const referralsRoutes     = require('./routes/referrals.routes');
const admissionsRoutes    = require('./routes/admissions.routes');
const roomsRoutes         = require('./routes/rooms.routes');
const doctorsRoutes       = require('./routes/doctors.routes');
const employeesRoutes     = require('./routes/employees.routes');
const dashboardRoutes     = require('./routes/dashboard.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const reportsRoutes       = require('./routes/reports.routes');
const adminRoutes         = require('./routes/admin.routes');

// ─── App Initialization ───────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;

// ─── Startup Environment Guard ────────────────────────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_NAME'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error('─────────────────────────────────────────');
  console.error('  FATAL: Missing required environment variables:');
  missingEnv.forEach((key) => console.error(`    ✗ ${key}`));
  console.error('  Create a .env file in the project root.');
  console.error('─────────────────────────────────────────');
  process.exit(1);
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ─── Body Parsers ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static Files (Lab Result Uploads) ───────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Static Files (Database Backups — auth enforced at route level) ──────────
// Note: direct /backups URL is blocked by requireRole at the route handler.
// This static mount is intentionally omitted; downloads go via /api/admin/backups/:filename.

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Salaam Hospital API is running.',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         usersRoutes);
app.use('/api/patients',      patientsRoutes);
app.use('/api/triages',       triagesRoutes);
app.use('/api/diagnoses',     diagnosesRoutes);
app.use('/api/referrals',     referralsRoutes);
app.use('/api/admissions',    admissionsRoutes);
app.use('/api/rooms',         roomsRoutes);
app.use('/api/doctors',       doctorsRoutes);
app.use('/api/employees',     employeesRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/reports',       reportsRoutes);
app.use('/api/admin',         adminRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error.',
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('─────────────────────────────────────────');
  console.log('  Salaam Hospital API');
  console.log(`  Server  : http://localhost:${PORT}`);
  console.log(`  Health  : http://localhost:${PORT}/api/health`);
  console.log(`  Client  : ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
  console.log(`  DB      : ${process.env.DB_NAME}@${process.env.DB_HOST}`);
  console.log('─────────────────────────────────────────');
});

module.exports = app;
