import { useState, useEffect } from 'react';
import { Paperclip } from 'lucide-react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Spinner from '../ui/Spinner';
import { getAllPatients } from '../../api/patients.api';
import { getExternalReferralContext } from '../../api/referrals.api';
import { patientLabel, findPatientByLabel } from '../../utils/patientLabels';
import { formatDate } from '../../utils/formatDate';
import { NO_BEDS_REASON } from '../../utils/constants';

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_MB  = 10;

// medical_condition can be a long clinical paragraph — keep dropdown options readable
const truncate = (str, n) => str?.length > n ? str.slice(0, n) + '…' : (str ?? '');
const diagnosisLabel = (d) => `${formatDate(d.diagnosis_date)} — ${truncate(d.medical_condition, 35)}`;

/**
 * ExternalReferralForm — hand a patient to a hospital OUTSIDE this system.
 *
 * Two modes, matching AdmissionForm:
 *   patientId supplied  → that patient is fixed (opened from a patient row/chart)
 *   no patientId        → searchable patient combobox (opened from a list page)
 *
 * The destination is picked from the admin-managed directory (Administration →
 * External Hospitals), not typed: at 2am with a full ER, nobody should be
 * re-typing a hospital's phone number from memory, and one spelling per
 * facility is what makes "where do we send patients" reportable.
 */
const ExternalReferralForm = ({ patientId, patientName, onSubmit, loading }) => {
  const standalone = !patientId;

  const [form, setForm] = useState({
    patient_id:           patientId ?? '',
    diagnosis_id:         '',
    external_hospital_id: '',
    external_reason:      '',
  });
  const [error,     setError]     = useState('');
  const [fetching,  setFetching]  = useState(true);
  const [capacity,  setCapacity]  = useState(null);
  const [hospitals, setHospitals] = useState([]);

  const [file,     setFile]     = useState(null);
  const [fileName, setFileName] = useState('');

  // Standalone patient lookup
  const [patients,          setPatients]          = useState([]);
  const [patientSearchText, setPatientSearchText] = useState('');

  // Diagnoses for the (optional) clinical link, loaded per patient
  const [diagnoses,   setDiagnoses]   = useState([]);
  const [diagLoading, setDiagLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Pull bed availability + the hospital directory + this patient's diagnoses in
  // one round trip. The capacity figure is what justifies the diversion, so it
  // is shown in-form and pre-fills the reason when there really are no beds.
  const loadContext = (pid) => {
    setDiagLoading(true);
    getExternalReferralContext(pid)
      .then((res) => {
        if (!res.success) return;
        setCapacity(res.data.capacity);
        setHospitals(res.data.hospitals ?? []);
        setDiagnoses(res.data.diagnoses ?? []);
        setForm((f) => ({
          ...f,
          external_reason: f.external_reason || (res.data.capacity?.at_capacity ? NO_BEDS_REASON : ''),
        }));
      })
      .catch(() => setError('Failed to load referral context.'))
      .finally(() => { setDiagLoading(false); setFetching(false); });
  };

  useEffect(() => {
    loadContext(patientId);
    if (standalone) {
      getAllPatients({ limit: 1000 }).then((res) => { if (res.success) setPatients(res.data); });
    }
  }, []);

  // Selecting a suggestion resolves the typed label back to a patient_id, then
  // reloads that patient's diagnoses.
  const handlePatientSelect = (e) => {
    const value = e.target.value;
    setPatientSearchText(value);
    setDiagnoses([]);
    setForm((f) => ({ ...f, diagnosis_id: '' }));

    const match = findPatientByLabel(patients, value);
    if (!match) {
      setForm((f) => ({ ...f, patient_id: '' }));
      return;
    }
    setForm((f) => ({ ...f, patient_id: match.patient_id }));
    loadContext(match.patient_id);
  };

  const handleFileChange = (e) => {
    const picked = e.target.files[0];
    if (!picked) { setFile(null); setFileName(''); return; }
    if (!ALLOWED_MIME.includes(picked.type)) {
      setError('Only PDF and image files (JPG, PNG, WebP, GIF) are allowed.');
      e.target.value = '';
      return;
    }
    if (picked.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File size must not exceed ${MAX_SIZE_MB} MB.`);
      e.target.value = '';
      return;
    }
    setError('');
    setFile(picked);
    setFileName(picked.name);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.patient_id) { setError('Select a patient to refer.'); return; }
    if (!form.external_hospital_id) { setError('Select the receiving hospital.'); return; }
    setError('');

    // multipart so multer can pick up the optional attachment — same contract
    // as the internal ReferralForm. Only the hospital's id is sent; the API
    // snapshots its name/contact/address onto the referral.
    const fd = new FormData();
    fd.append('patient_id', String(form.patient_id));
    if (form.diagnosis_id) fd.append('diagnosis_id', String(form.diagnosis_id));
    fd.append('external_hospital_id', String(form.external_hospital_id));
    if (form.external_reason.trim()) fd.append('external_reason', form.external_reason.trim());
    if (file) fd.append('file_attachment', file);

    onSubmit(fd);
  };

  // The chosen entry's contact details, shown read-only under the dropdown so
  // the person arranging the transfer can dial without leaving the form.
  const selectedHospital = hospitals.find(
    (h) => String(h.hospital_id) === String(form.external_hospital_id)
  );

  if (fetching) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      {/* Why this is happening — states the bed count rather than asserting "full" blindly */}
      {capacity && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert
            type={capacity.at_capacity ? 'warning' : 'info'}
            message={capacity.at_capacity
              ? `No beds available (0 of ${capacity.total_rooms}). This patient will be referred to another facility.`
              : `${capacity.available_rooms} of ${capacity.total_rooms} beds are still available here — refer out only if this facility cannot provide the care needed.`}
          />
        </div>
      )}

      {/* Patient — fixed when opened from a chart, searchable otherwise */}
      <div className="form-group">
        {standalone ? (
          <>
            <label htmlFor="erf-pat">Patient *</label>
            <input
              id="erf-pat"
              list="erf-patient-options"
              value={patientSearchText}
              onChange={handlePatientSelect}
              placeholder="Search patient by name"
              autoComplete="off"
              required
            />
            <datalist id="erf-patient-options">
              {patients.map((p) => (
                <option key={p.patient_id} value={patientLabel(p, patients)} />
              ))}
            </datalist>
          </>
        ) : (
          <>
            <label htmlFor="erf-pat">Patient</label>
            <div
              id="erf-pat"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-surface-2)',
                color: 'var(--color-text-muted)',
                minHeight: '38px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {patientName || 'Selected patient'}
            </div>
          </>
        )}
      </div>

      {/* Optional diagnosis link — a patient turned away at intake may not have one */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="erf-diag">Related Diagnosis (optional)</label>
        <div style={{ overflow: 'hidden', width: '100%' }}>
          <select
            id="erf-diag"
            value={form.diagnosis_id}
            onChange={set('diagnosis_id')}
            size="1"
            style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            <option value="">— None —</option>
            {diagnoses.map((d) => (
              <option key={d.diagnosis_id} value={d.diagnosis_id}>{diagnosisLabel(d)}</option>
            ))}
          </select>
        </div>
        {diagLoading && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            Loading diagnoses…
          </span>
        )}
        {!diagLoading && form.patient_id && diagnoses.length === 0 && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            No diagnoses recorded — a referral out does not require one.
          </span>
        )}
      </div>

      {/* ── Receiving facility — chosen from the admin-managed directory ── */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="erf-hosp">Receiving Hospital *</label>
        <select
          id="erf-hosp"
          value={form.external_hospital_id}
          onChange={set('external_hospital_id')}
          disabled={hospitals.length === 0}
          required
        >
          <option value="">— Select a hospital —</option>
          {hospitals.map((h) => (
            <option key={h.hospital_id} value={h.hospital_id}>{h.name}</option>
          ))}
        </select>

        {/* An empty directory is an admin task, not a form error — say so
            rather than leaving an unexplained dead dropdown. */}
        {hospitals.length === 0 && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>
            No external hospitals have been set up yet. An admin must add them under
            Administration → External Hospitals before a patient can be referred out.
          </span>
        )}
      </div>

      {/* Contact details of the selection — read-only; edited by an admin in
          the directory, so they stay consistent across every referral. */}
      {selectedHospital && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-3)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <span>
            <strong>Contact:</strong>{' '}
            {selectedHospital.contact_number || <span style={{ color: 'var(--color-text-muted)' }}>Not on record</span>}
          </span>
          <span>
            <strong>Address:</strong>{' '}
            {selectedHospital.address || <span style={{ color: 'var(--color-text-muted)' }}>Not on record</span>}
          </span>
        </div>
      )}

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="erf-reason">Reason for Referral</label>
        <textarea
          id="erf-reason"
          rows={3}
          value={form.external_reason}
          onChange={set('external_reason')}
          placeholder="Why this patient is being transferred out"
        />
      </div>

      {/* ── Attachment (optional) — same contract as the internal referral form ── */}
      <div className="lab-upload-section">
        <p className="lab-upload-heading">
          Referral Document&nbsp;
          <span className="lab-upload-optional">(optional — PDF or image, max {MAX_SIZE_MB} MB)</span>
        </p>
        <div className="file-input-wrapper">
          <button
            type="button"
            className="file-input-btn"
            onClick={() => document.getElementById('erf-file')?.click()}
          >
            <Paperclip size={14} /> {file ? 'Change File' : 'Attach Document'}
          </button>
          <span className="file-input-name">{fileName || 'No file chosen'}</span>
          {file && (
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 'var(--font-size-xs)' }}
              onClick={() => {
                setFile(null); setFileName('');
                const el = document.getElementById('erf-file');
                if (el) el.value = '';
              }}
              title="Remove attachment"
            >
              ✕
            </button>
          )}
          <input
            id="erf-file"
            type="file"
            accept="application/pdf,image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading} disabled={hospitals.length === 0}>
          Refer to External Hospital
        </Button>
      </div>
    </form>
  );
};

export default ExternalReferralForm;
