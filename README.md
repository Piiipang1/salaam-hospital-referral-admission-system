# salaam-hospital-referral-admission-system
Responsive Web-Based Patient Referral and Admission System for Salaam Hospital featuring patient registration, triage management, internal referrals, admission processing, room assignment, medical record tracking, and role-based access control.

# Responsive Web-Based Patient Referral and Admission System for Salaam Hospital

## Overview

The Responsive Web-Based Patient Referral and Admission System for Salaam Hospital is a healthcare information system designed to digitize and streamline patient admission, triage, referral, and medical record management processes.

The system eliminates manual paper-based workflows by providing a centralized platform for hospital staff, doctors, nurses, and administrators.

## Objectives

- Digitize patient registration and admission processes
- Improve internal referral management
- Track patient medical history and treatment records
- Monitor room and bed availability
- Enhance communication among healthcare providers
- Reduce administrative workload and human errors

## Features

### Authentication & Security
- Secure Login
- Role-Based Access Control
- User Management

### Patient Management
- Patient Registration
- Patient Profile Management
- Medical History Tracking

### Triage Management
- Vital Signs Recording
- Priority Level Assignment
- Doctor Assignment

### Referral Management
- Internal Referral Creation
- Referral Status Tracking
- Referral History Logs

### Admission Management
- Admission Processing
- Room Assignment
- Bed Availability Monitoring

### Reporting
- Admission Reports
- Referral Reports
- Dashboard Analytics

## Technology Stack

### Frontend
- React.js
- HTML5
- CSS3
- JavaScript

### Backend
- Node.js
- Express.js

### Database
- MySQL

### Development Tools
- Visual Studio Code
- XAMPP
- Git
- GitHub

## System Users

- Administrator
- Doctor
- Nurse
- Hospital Staff

## 📂 Project Structure

```text
patient-referral-admission-system/
│
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
│
├── backend/
│   ├── routes/
│   ├── controllers/
│   ├── models/
│   ├── middleware/
│   └── package.json
│
├── database/
│   └── hospital_db.sql
│
├── screenshots/
│
├── README.md
└── LICENSE
```

##How to run it

1. Create the backend environment file from the template and fill in your values
   (see the Security notes below for JWT_SECRET):
```
cd backend
cp .env.example .env
# then edit .env with your DB credentials and a freshly generated JWT_SECRET
```

2. Make sure both servers are running:
```
# Terminal 1 — Backend
cd backend
node server.js

# Terminal 2 — Frontend
cd frontend
npm run dev
```

## Security notes

- **Secrets are environment-only.** All secrets (`JWT_SECRET`, database
  credentials) live in `backend/.env`, which is git-ignored and must never be
  committed. Only `backend/.env.example` — a template with placeholder values —
  is tracked. `server.js` is the single loader of this file; no other module
  calls `dotenv.config()`.
- **Rotate `JWT_SECRET` on every deployment.** Generate a fresh 64-hex-char
  value per environment (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
  Rotating it invalidates all active sessions, forcing everyone to log in
  again — this is expected, and is the intended way to revoke all outstanding
  tokens at once.
- **Backups and uploads contain PHI.** `backend/backups/` (mysqldump exports)
  and `backend/uploads/` (patient documents) hold protected health information
  and are git-ignored — they must never be committed. Only an empty
  `backend/uploads/.gitkeep` is tracked so the directory exists on a fresh
  clone.
