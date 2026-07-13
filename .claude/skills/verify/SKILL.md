---
name: verify
description: Build/launch/drive recipe for verifying changes to the Salaam Hospital referral & admission system (Express API + React frontend + XAMPP MariaDB).
---

# Verifying this app

## Stack
- MariaDB via XAMPP (`C:/xampp/mysql`), DB `salaam_hospital`, user `root`, no password.
- Backend: Express on port 5000 — `cd backend && node server.js` (reads `backend/.env`).
- Frontend: Vite on port 5173 — `cd frontend && npm run dev`.

## Start order
1. MySQL: `C:/xampp/mysql/bin/mysqld.exe --defaults-file=C:/xampp/mysql/bin/my.ini --console` (background).
   - **Gotcha:** startup can abort with "Failed to initialize multi master structures" — the data dir accumulates corrupt `master-*.info`, `relay-log-*`, and `multi-master.info` files (console log lines written as replication filenames). Move ALL of them (including `multi-master.info`, and re-sweep after a failed start recreates some) out of `C:/xampp/mysql/data/` and retry.
   - Ready check: `C:/xampp/mysql/bin/mysql.exe -u root -e "SELECT 1"`.
2. Backend, then frontend (both background). Backend ready when `curl http://localhost:5000/api/auth/login` responds.

## Test logins (database/seed.sql)
admin/admin123, doctor1/doctor123 (Doctor-in-Charge), doctor2–3/doctor123, nurse1–2/nurse123, staff1–2/staff123.

## Driving
- API: login `POST /api/auth/login {username,password}` → `Bearer <token>`. Roles enforced per route in `backend/routes/*.routes.js`.
- DB assertions: `C:/xampp/mysql/bin/mysql.exe -u root salaam_hospital -e "..."` (tables: triages, doctor_in_charge, notifications, patients).
- UI: no full `playwright` install, but Chromium is cached. Install `playwright-core` in the scratchpad and launch with
  `executablePath: process.env.LOCALAPPDATA + '/ms-playwright/chromium-1228/chrome-win64/chrome.exe'` against http://localhost:5173.
  Use forward slashes in the path when inlining via `node -e` under bash (backslash escapes get eaten).

## Flows worth driving
- Triage: nurse1 → /triage → "+ Record Triage" / "Emergency Triage" modals.
- DIC coordination: doctor1 → /triage → "Unassigned only" pill → "Assign doctor" modal; scoping means patients disappear from views when assigned to someone else (a 404 on a patient detail can be correct scoping, not a bug).
