import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDate } from '../../utils/formatDate';
import { formatPatientAge, formatPatientSex } from '../../utils/patientLabels';
import './PrintView.css';

/**
 * PatientPrintView — full chronological patient record print component.
 *
 * Renders into a React portal (a div appended to document.body) so that
 * @media print CSS can hide everything else on the page.
 * Calls window.print() automatically after mounting.
 *
 * Props:
 *   patient    — patient object from GET /api/patients/:id
 *   history    — { triages, diagnoses, referrals, admissions, opd_followups }
 *   printedBy  — display name of the logged-in user
 *   onClose    — called after print dialog closes
 */
const PatientPrintView = ({ patient, history, printedBy, onClose }) => {
  const [portalEl, setPortalEl] = useState(null);

  useEffect(() => {
    // Create (or reuse) the portal container
    let el = document.getElementById('print-portal-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'print-portal-root';
      el.className = 'print-portal';
      document.body.appendChild(el);
    }
    setPortalEl(el);

    const timer = setTimeout(() => {
      window.print();
      const afterPrint = () => {
        window.removeEventListener('afterprint', afterPrint);
        onClose?.();
      };
      window.addEventListener('afterprint', afterPrint);
    }, 200);

    return () => {
      clearTimeout(timer);
      // Clean up portal content on unmount
      if (el) el.innerHTML = '';
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data ──────────────────────────────────────────────────────────────────
  const triages      = history?.triages       ?? [];
  const diagnoses    = history?.diagnoses     ?? [];
  const referrals    = history?.referrals     ?? [];
  const admissions   = history?.admissions    ?? [];
  const opdFollowups = history?.opd_followups ?? [];

  // Group triages by visit_number
  const triagesByVisit = {};
  for (const t of triages) {
    const vn = t.visit_number ?? 1;
    (triagesByVisit[vn] ??= []).push(t);
  }

  // Map triage_id → visit_number for diagnoses/referrals/admissions
  const visitByTriageId = Object.fromEntries(
    triages.map((t) => [t.triage_id, t.visit_number ?? 1])
  );
  const diagnosesByVisit = {};
  for (const d of diagnoses) {
    const vn = d.triage_id != null ? (visitByTriageId[d.triage_id] ?? 1) : 1;
    (diagnosesByVisit[vn] ??= []).push(d);
  }
  const visitByDiagnosisId = Object.fromEntries(
    diagnoses
      .filter((d) => d.triage_id != null)
      .map((d) => [d.diagnosis_id, visitByTriageId[d.triage_id] ?? 1])
  );

  const visitNumbers = [
    ...new Set([
      ...Object.keys(triagesByVisit).map(Number),
      ...Object.keys(diagnosesByVisit).map(Number),
    ]),
  ].sort((a, b) => a - b);

  const printedAt = formatDate(new Date().toISOString(), true);

  // ── Content ───────────────────────────────────────────────────────────────
  const content = (
    <div className="print-root">
      {/* Header */}
      <div className="print-header">
        <h1>Salaam Hospital — Patient Medical Record</h1>
        <p>Confidential — For authorized personnel only</p>
      </div>

      {/* Patient demographics */}
      <div className="print-section-title">Patient Information</div>
      <div className="print-info-grid">
        <div className="print-info-item">
          <span className="print-info-label">Full Name</span>
          <span className="print-info-value">
            {patient.first_name} {patient.last_name}
            {patient.is_unidentified ? ' [UNIDENTIFIED]' : ''}
          </span>
        </div>
        <div className="print-info-item">
          <span className="print-info-label">Patient ID</span>
          <span className="print-info-value">#{patient.patient_id}</span>
        </div>
        <div className="print-info-item">
          <span className="print-info-label">Sex</span>
          <span className="print-info-value">{formatPatientSex(patient)}</span>
        </div>
        <div className="print-info-item">
          <span className="print-info-label">Age / Date of Birth</span>
          <span className="print-info-value">
            {formatPatientAge(patient)} yrs — {formatDate(patient.date_of_birth)}
          </span>
        </div>
        <div className="print-info-item">
          <span className="print-info-label">Contact Number</span>
          <span className="print-info-value">{patient.contact_number || '—'}</span>
        </div>
        <div className="print-info-item">
          <span className="print-info-label">Address</span>
          <span className="print-info-value">{patient.address || '—'}</span>
        </div>
        <div className="print-info-item">
          <span className="print-info-label">Emergency Contact</span>
          <span className="print-info-value">
            {patient.emergency_contact_name || '—'}
            {patient.emergency_contact_number
              ? ` · ${patient.emergency_contact_number}`
              : ''}
          </span>
        </div>
        <div className="print-info-item">
          <span className="print-info-label">Registered</span>
          <span className="print-info-value">{formatDate(patient.created_at, true)}</span>
        </div>
      </div>

      {/* Visit history */}
      <div className="print-section-title">Medical History by Visit</div>
      {visitNumbers.length === 0 && (
        <p className="print-record-meta">No triage or diagnosis records on file.</p>
      )}

      {visitNumbers.map((vn) => {
        const vTriages   = triagesByVisit[vn]    ?? [];
        const vDiagnoses = diagnosesByVisit[vn]  ?? [];
        const vReferrals = referrals.filter((r) => {
          const dvn = r.diagnosis_id != null ? (visitByDiagnosisId[r.diagnosis_id] ?? 1) : 1;
          return dvn === vn;
        });
        const vAdmissions = admissions.filter((a) => {
          const dvn = a.diagnosis_id != null ? (visitByDiagnosisId[a.diagnosis_id] ?? 1) : 1;
          return dvn === vn;
        });
        const firstTriageDate =
          vTriages.length > 0
            ? vTriages[vTriages.length - 1].triage_datetime
            : null;

        return (
          <div key={vn} className="print-visit-block">
            <p className="print-visit-title">
              Visit {vn}
              {firstTriageDate
                ? ` — First triaged ${formatDate(firstTriageDate, true)}`
                : ''}
            </p>

            {/* Triages */}
            {vTriages.length > 0 && (
              <>
                <p style={{ fontWeight: 'bold', fontSize: '10pt', margin: '6pt 0 3pt' }}>
                  Triage Records
                </p>
                {vTriages.map((t) => (
                  <div key={t.triage_id} className="print-record-block">
                    <p className="print-record-title">
                      {t.triage_level} — {formatDate(t.triage_datetime, true)}
                      {t.visit_type ? ` (${t.visit_type})` : ''}
                    </p>
                    {t.notes && (
                      <p className="print-record-body">Chief complaint: {t.notes}</p>
                    )}
                    {t.blood_pressure && (
                      <div className="print-vitals-row">
                        <span>BP: {t.blood_pressure}</span>
                        <span>HR: {t.heart_rate} bpm</span>
                        <span>Temp: {t.temperature}°C</span>
                        <span>RR: {t.respiratory_rate}/min</span>
                        <span>Recorded: {formatDate(t.vitals_recorded_at, true)}</span>
                        {t.vitals_updated_at && (
                          <span>Updated: {formatDate(t.vitals_updated_at, true)}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Diagnoses */}
            {vDiagnoses.length > 0 && (
              <>
                <p style={{ fontWeight: 'bold', fontSize: '10pt', margin: '6pt 0 3pt' }}>
                  Diagnoses
                </p>
                {vDiagnoses.map((d) => (
                  <div key={d.diagnosis_id} className="print-record-block">
                    <p className="print-record-title">{d.medical_condition}</p>
                    <p className="print-record-meta">
                      {formatDate(d.diagnosis_date, true)}
                      {d.doctor_name ? ` · Dr. ${d.doctor_name}` : ''}
                    </p>
                    {d.treatments?.length > 0 && (
                      <>
                        <p className="print-record-meta" style={{ marginTop: '3pt' }}>
                          Treatments:
                        </p>
                        <ul className="print-sublist">
                          {d.treatments.map((tx) => (
                            <li key={tx.treatment_id}>
                              {tx.prescribed_medications} — {tx.dosage}, {tx.frequency},{' '}
                              {tx.treatment_duration}
                              {tx.created_at
                                ? ` (ordered ${formatDate(tx.created_at, true)})`
                                : ''}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {d.lab_results?.length > 0 && (
                      <>
                        <p className="print-record-meta" style={{ marginTop: '3pt' }}>
                          Lab Results:
                        </p>
                        <ul className="print-sublist">
                          {d.lab_results.map((lr) => (
                            <li key={lr.lab_result_id}>
                              {lr.test_type || 'Lab Result'}
                              {lr.results ? `: ${lr.results}` : ''}
                              {lr.date_conducted
                                ? ` — ${formatDate(lr.date_conducted, true)}`
                                : ''}
                              {lr.file_attachment ? ' [file attached — view in system]' : ''}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Referrals */}
            {vReferrals.length > 0 && (
              <>
                <p style={{ fontWeight: 'bold', fontSize: '10pt', margin: '6pt 0 3pt' }}>
                  Referrals
                </p>
                {vReferrals.map((r) => (
                  <div key={r.referral_id} className="print-record-block">
                    <p className="print-record-title">
                      {r.is_external ? 'External Referral' : 'Referral'} — {r.status}
                    </p>
                    <p className="print-record-meta">{formatDate(r.referral_date, true)}</p>
                    {r.referring_doctor_name && (
                      <p className="print-record-meta">
                        Referred by: Dr. {r.referring_doctor_name}
                      </p>
                    )}
                    {r.assigned_doctor_name && (
                      <p className="print-record-meta">
                        Referred to: {r.assigned_doctor_name}
                      </p>
                    )}
                    {r.external_hospital_name && (
                      <p className="print-record-meta">Hospital: {r.external_hospital_name}</p>
                    )}
                    {r.remarks && (
                      <p className="print-record-body">Remarks: {r.remarks}</p>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Admissions */}
            {vAdmissions.length > 0 && (
              <>
                <p style={{ fontWeight: 'bold', fontSize: '10pt', margin: '6pt 0 3pt' }}>
                  Admissions
                </p>
                {vAdmissions.map((a) => (
                  <div key={a.admission_id} className="print-record-block">
                    <p className="print-record-title">
                      {a.admission_type} — {a.status}
                    </p>
                    <p className="print-record-meta">
                      Admitted: {formatDate(a.admission_date, true)}
                      {a.discharge_date
                        ? ` · Discharged: ${formatDate(a.discharge_date, true)}`
                        : ''}
                    </p>
                    {a.bed_number && (
                      <p className="print-record-meta">
                        Room: {a.room_type} — {a.bed_number}
                      </p>
                    )}
                    {a.doctor_name && (
                      <p className="print-record-meta">Doctor: Dr. {a.doctor_name}</p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}

      {/* OPD Follow-ups */}
      {opdFollowups.length > 0 && (
        <>
          <div className="print-section-title">OPD Follow-ups</div>
          {opdFollowups.map((f) => (
            <div key={f.followup_id} className="print-record-block print-avoid-break">
              <p className="print-record-title">
                {f.clinic_name ?? 'Clinic not set'} — {f.status}
              </p>
              <p className="print-record-meta">
                Scheduled: {formatDate(f.followup_date)}
                {f.doctor_name ? ` · Dr. ${f.doctor_name}` : ''}
              </p>
              {f.medical_condition && (
                <p className="print-record-meta">Continuing: {f.medical_condition}</p>
              )}
              {f.discharge_date && (
                <p className="print-record-meta">
                  From stay discharged: {formatDate(f.discharge_date, true)}
                </p>
              )}
            </div>
          ))}
        </>
      )}

      {/* Footer */}
      <div className="print-footer">
        <span>Printed by: {printedBy}</span>
        <span>Printed at: {printedAt}</span>
      </div>
    </div>
  );

  if (!portalEl) return null;
  return createPortal(content, portalEl);
};

export default PatientPrintView;
