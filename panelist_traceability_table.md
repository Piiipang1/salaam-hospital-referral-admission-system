# Panelist Comment Traceability Table

**Salaam Hospital Referral & Admission System**
Mapping of every panelist comment to the page(s) where the implementation can be seen and demonstrated.

---

## Part 1 — Panelist Comments (12 Items)

| # | Panelist Comment | Implementation Summary | Page / Screen Where Visible | Route | Role(s) |
|---|---|---|---|---|---|
| 01 | No rooms available — no admit, registering, or triaging patient | Capacity banner appears and disables registration, triage, and admission buttons when 0 beds are free. Returns HTTP 409. | **Patients Page** (banner + disabled "Register Patient" btn), **Triage Page** (banner + disabled "Record Triage" btn), **Admissions Page** (banner + disabled actions), **Patient Detail Page** (banner) | `/patients`, `/triage`, `/admissions`, `/patients/:id` | Doctor, Nurse |
| 02 | Add refer to other hospital if full | Admin-managed directory of external hospitals with auto-fill contact details. External referral form available on Patients, Patient Detail, and Admissions pages. | **External Hospitals Page** (admin manages the directory), **Patients Page** (modal: "Refer to External Hospital" btn when at capacity), **Patient Detail Page** (referral action), **Admissions Page** (referral action) | `/external-hospitals`, `/patients`, `/patients/:id`, `/admissions` | Admin (directory), Doctor (referral) |
| 03 | Add nurse assigned department — attending nurse should endorse its data to the next on-duty nurse | Departments table with nurse assignment. Endorsement flow: outgoing nurse selects patients → adds per-patient notes → submits to incoming nurse → incoming nurse acknowledges to accept. | **My Ward Page** (nurse sees patients in their department), **Endorsements Page** (create endorsement form, view pending/history, acknowledge incoming) | `/ward`, `/endorsements` | Nurse |
| 04 | Add checklist before nurse clicks discharge — billing, clearance, doctor's order | Three-item checklist (Billing Cleared, Hospital Clearance, Doctor's Discharge Order). All must be verified before discharge can be confirmed. Doctor's order is auto-recorded, not manually tickable by nurses. | **Admissions Page** (inside the discharge confirmation modal — checklist appears when nurse clicks "Confirm Discharge") | `/admissions` | Nurse (billing & clearance ticks), Doctor (order auto-set) |
| 05 | Patient record should include follow-up checkup upon discharge — treated as OPD under a clinic | OPD follow-up date and clinic auto-assigned on discharge. Clinic routed by doctor specialization → admission type → default. Nurse can override. | **Admissions Page** (OPD follow-up fields in discharge confirmation modal), **Patient Detail Page** (follow-up displayed in patient history/stay record) | `/admissions`, `/patients/:id` | Doctor, Nurse |
| 06 | Add note/remarks on doctor referral | Remarks field required (10-char minimum) on internal referrals. Enforced at API level. | **Referrals Page** (remarks field in "Create Referral" form; remarks displayed on referral cards/rows) | `/referrals` | Doctor |
| 07 | Referral should be about the related disease that cannot be treated by the assigned doctor — Doctor on heart (main), Doctor on eye (new) | Cross-specialty referral rule: referrals to a doctor of the same specialization are rejected. Two specialists seeded — Cardiology and Ophthalmology. | **Referrals Page** (validation error shown when attempting same-specialty referral; specialty displayed on doctor selection) | `/referrals` | Doctor |
| 08 | On the doctor's patient list, show the status — discharged, admitted, or waiting | Care status badge (Admitted / Discharged / Waiting) with detail subtitle shown per patient row. Derived live from admissions data. | **Patients Page** ("Status" column in patients table), **Patient Detail Page** (status badge at top of record) | `/patients`, `/patients/:id` | Doctor, Nurse |
| 09 | In Record Triage — make patient selection searchable instead of a scroll-down | Type-ahead patient search component replaces the old full-list dropdown. Debounced API search by name or patient ID. | **Triage Page** (inside "Record Triage" modal — patient picker field) | `/triage` | Nurse |
| 10 | When doctors initiate discharge, only the attending nurse should be notified, not all nurses | Notification routing: assigned nurse → ward nurses → all nurses (last resort). Message wording differs by tier. | **Notifications Page** (attending nurse receives discharge notification; other nurses don't unless fallback applies) | `/notifications` | Nurse |
| 11 | Remove staff role | All 15 staff accounts converted to nurse. Staff ENUM removed from database. Creating a staff user returns HTTP 400. | **User Management Page** (role dropdown no longer shows "Staff"; converted accounts appear as Nurse), **Login Page** (former staff accounts log in as nurses) | `/users`, `/login` | Admin |
| 12 | All roles receive important notifications either through SMS or email | Notifications carry priority (Normal / High / Emergency). Normal = in-app only, High = + email, Emergency = + SMS. Contact fields added to user accounts. | **Notifications Page** (priority badges on notifications), **Profile Page** (email/phone fields for alert delivery), **User Management Page** (contact fields on user records) | `/notifications`, `/profile`, `/users` | All roles |

---

## Part 2 — Unlisted Fixes (Not from panelist comments)

| # | Fix Description | What Was Wrong | Page / Screen Where Visible | Route | Role(s) |
|---|---|---|---|---|---|
| A | Mobile view across all roles | My Ward, Endorsements, and External Hospitals were unreachable on mobile. Bottom nav didn't include new pages. Form inputs triggered iOS zoom. Tap targets too small. | **All 17 pages** (responsive layout, bottom navigation on mobile) — demonstrated by resizing browser to 375×812 | All routes | All roles |
| B | Roomed patients showed as "Unassigned" | `assignRoom` did not create a `nurse_assignments` row, so patients appeared in the ward with no nurse attached. | **My Ward Page** (roomed patients now appear under the nurse who roomed them), **Admissions Page** (room assignment flow) | `/ward`, `/admissions` | Nurse |
| C | Pending Discharge join bug | Ongoing-admission join omitted "Pending Discharge" status, hiding room info for patients awaiting discharge. | **Patients Page** and **Patient Detail Page** (patient awaiting discharge now shows their room) | `/patients`, `/patients/:id` | Doctor, Nurse |
| D | Patient ID search fix | `patient_id LIKE '%N%'` could not use the primary key — searching "1" matched 1, 11, 21, 120. | **Triage Page** (patient typeahead — searching by patient ID now gives exact results) | `/triage` | Nurse |
| E | Shared access scope | New search endpoint would have duplicated role-scoping rules. Extracted to one definition. | Backend only — no visible UI change (ensures search results respect the same access rules as the patient list) | `/patients`, `/triage` | Doctor, Nurse |
| F | Discharge releases nurse | Nothing released a nurse's caseload on discharge — discharged patients lingered on active list. | **My Ward Page** (discharged patients no longer appear on nurse's active list) | `/ward` | Nurse |
| G | One nurse per patient (DB constraint) | Rule existed only in application code. Now enforced by database via generated column. | **My Ward Page** / **Admissions Page** (assigning a second nurse to the same patient is rejected) | `/ward`, `/admissions` | Nurse |
| H | Delivery audit trail | No record of whether an SMS/email alert left the building. Every attempt is now logged. | **Audit Page** (delivery records visible in audit trail) | `/audit` | Admin |

---

## Quick-Reference: Page Index

For the panelist's convenience — every page in the system and which comments it demonstrates:

| Page Name | Route | Role Access | Comments Demonstrated |
|---|---|---|---|
| **Login** | `/login` | All | 11 |
| **Dashboard** | `/dashboard` | All | — |
| **Patients** | `/patients` | Doctor, Nurse | 01, 02, 05, 08, C |
| **Patient Detail** | `/patients/:id` | Doctor, Nurse | 01, 02, 05, 08, C |
| **Triage** | `/triage` | Doctor, Nurse | 01, 09, D |
| **Triage Detail** | `/triage/:id` | Doctor, Nurse | — |
| **Referrals** | `/referrals` | Doctor | 06, 07 |
| **Admissions** | `/admissions` | Doctor, Nurse | 01, 02, 04, 05, B, G |
| **Rooms** | `/rooms` | Admin, Nurse | — |
| **My Ward** | `/ward` | Nurse | 03, B, F, G |
| **Endorsements** | `/endorsements` | Nurse | 03 |
| **External Hospitals** | `/external-hospitals` | Admin | 02 |
| **Notifications** | `/notifications` | All | 10, 12 |
| **Profile** | `/profile` | All | 12 |
| **User Management** | `/users` | Admin | 11, 12 |
| **Reports** | `/reports` | Admin | — |
| **Audit** | `/audit` | Admin | H |
| **All Pages (Mobile)** | All | All | A |
