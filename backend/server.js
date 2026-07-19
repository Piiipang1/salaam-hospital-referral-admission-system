const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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
const assignmentsRoutes   = require('./routes/assignments.routes');
const filesRoutes         = require('./routes/files.routes');
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

// Trust the first proxy hop (deployment targets Render, which sits behind a
// reverse proxy). Without this, req.ip is the proxy's IP and express-rate-limit
// keys every user's login attempts into one shared bucket.
app.set('trust proxy', 1);

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

// ─── Security Headers ─────────────────────────────────────────────────────────
// helmet defaults, except cross-origin-resource-policy: the frontend at a
// different origin (localhost:5173) must be able to load /uploads images/PDFs.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

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

// ─── Uploaded Patient Files (PHI — auth enforced at route level) ─────────────
// Served ONLY through GET /api/files/:filename behind the auth middleware.
// The old unauthenticated express.static('/uploads') mount was removed: it let
// anyone with a URL download lab results / referral attachments.
//
// Database backups are likewise never statically served — downloads go through
// /api/admin/backups/:filename, gated by requireRole('admin').

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
app.use('/api/assignments',   assignmentsRoutes);
app.use('/api/files',         filesRoutes);
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
