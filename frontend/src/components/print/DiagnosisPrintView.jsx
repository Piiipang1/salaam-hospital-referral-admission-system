import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDate } from '../../utils/formatDate';
import './PrintView.css';

/**
 * DiagnosisPrintView — prints a single diagnosis with its treatments,
 * lab results, and doctor assessment.
 *
 * Props:
 *   patient    — patient object (name, id)
 *   diagnosis  — full diagnosis object including treatments[] and lab_results[]
 *   assessment — doctor assessment object { disposition, clinical_notes, assessed_at }
 *                or null if none recorded
 *   printedBy  — display name of the logged-in user
 *   onClose    — called after print dialog closes
 */
const DiagnosisPrintView = ({ patient, diagnosis, assessment, printedBy, onClose }) => {
  const [portalEl, setPortalEl] = useState(null);

  useEffect(() => {
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
      if (el) el.innerHTML = '';
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const printedAt = formatDate(new Date().toISOString(), true);

  const content = (
    <div className="print-root">
      {/* Header */}
      <div className="print-header">
        <h1>Salaam Hospital — Diagnosis Report</h1>
        <p>Confidential — For authorized personnel only</p>
      </div>

      {/* Patient summary */}
      <div className="print-section-title">Patient</div>
      <div className="print-info-grid">
        <div className="print-info-item">
          <span className="print-info-label">Full Name</span>
          <span className="print-info-value">
            {patient.first_name} {patient.last_name}
          </span>
        </div>
        <div className="print-info-item">
          <span className="print-info-label">Patient ID</span>
          <span className="print-info-value">#{patient.patient_id}</span>
        </div>
      </div>

      {/* Diagnosis */}
      <div className="print-section-title">Diagnosis</div>
      <div className="print-record-block">
        <p className="print-record-title">{diagnosis.medical_condition}</p>
        <p className="print-record-meta">
          Date: {formatDate(diagnosis.diagnosis_date, true)}
          {diagnosis.doctor_name ? ` · Dr. ${diagnosis.doctor_name}` : ''}
        </p>
      </div>

      {/* Doctor Assessment */}
      <div className="print-section-title">Doctor Assessment</div>
      {assessment ? (
        <div className="print-record-block">
          <p className="print-record-title">
            Disposition: {assessment.disposition}
          </p>
          <p className="print-record-meta">
            Assessed: {formatDate(assessment.assessed_at, true)}
          </p>
          {assessment.clinical_notes && (
            <p className="print-record-body" style={{ whiteSpace: 'pre-wrap' }}>
              {assessment.clinical_notes}
            </p>
          )}
        </div>
      ) : (
        <p className="print-record-meta">No assessment recorded for this diagnosis.</p>
      )}

      {/* Treatments */}
      <div className="print-section-title">Treatment Plan</div>
      {(!diagnosis.treatments || diagnosis.treatments.length === 0) ? (
        <p className="print-record-meta">No treatments recorded.</p>
      ) : (
        diagnosis.treatments.map((tx) => (
          <div key={tx.treatment_id} className="print-record-block print-avoid-break">
            <p className="print-record-title">{tx.prescribed_medications}</p>
            <p className="print-record-meta">
              Dosage: {tx.dosage || '—'} · Frequency: {tx.frequency || '—'} ·
              Duration: {tx.treatment_duration || '—'}
            </p>
            {tx.created_at && (
              <p className="print-record-meta">
                Ordered: {formatDate(tx.created_at, true)}
              </p>
            )}
          </div>
        ))
      )}

      {/* Lab Results */}
      <div className="print-section-title">Lab Results</div>
      {(!diagnosis.lab_results || diagnosis.lab_results.length === 0) ? (
        <p className="print-record-meta">No lab results recorded.</p>
      ) : (
        diagnosis.lab_results.map((lr) => (
          <div key={lr.lab_result_id} className="print-record-block print-avoid-break">
            <p className="print-record-title">{lr.test_type || 'Lab Result'}</p>
            {lr.results && (
              <p className="print-record-body">{lr.results}</p>
            )}
            {lr.date_conducted && (
              <p className="print-record-meta">
                Conducted: {formatDate(lr.date_conducted, true)}
              </p>
            )}
            {lr.file_attachment && (
              <p className="print-record-meta">
                File: {lr.file_attachment} [view in system]
              </p>
            )}
          </div>
        ))
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

export default DiagnosisPrintView;
