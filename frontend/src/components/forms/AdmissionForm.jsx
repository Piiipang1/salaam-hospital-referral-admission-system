import { useState, useEffect } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Spinner from '../ui/Spinner';
import { ADMISSION_TYPES } from '../../utils/constants';
import { getActiveDoctors } from '../../api/doctors.api';
import { getPatientHistory, getAllPatients } from '../../api/patients.api';
import { useAuth } from '../../context/AuthContext';

// medical_condition can be a long clinical paragraph — keep dropdown options readable
const truncate = (str, n) => str?.length > n ? str.slice(0, n) + '…' : (str ?? '');

// Build the dropdown label for a diagnosis option — diagnosis ID is already unique, so skip the date
const diagnosisLabel = (d) => `Dx#${d.diagnosis_id} — ${truncate(d.medical_condition, 35)}`;

// Build the searchable combobox label for a patient option
const patientLabel = (p) => `${p.first_name} ${p.last_name} (ID: ${p.patient_id})`;

const AdmissionForm = ({ patientId, diagnosisId, initial = {}, onSubmit, loading }) => {
  const { user } = useAuth();
  const isDoctor = user?.role === 'doctor';

  const [form, setForm] = useState({
    patient_id:     initial.patient_id   ?? patientId   ?? '',
    diagnosis_id:   initial.diagnosis_id ?? diagnosisId ?? '',
    // For a doctor, pre-fill with their own linked_id — the backend is the
    // source of truth regardless, but this keeps the field non-empty.
    doctor_id:      initial.doctor_id    ?? (isDoctor ? user?.linked_id ?? '' : ''),
    admission_type: initial.admission_type ?? '',
  });
  const [error,   setError]   = useState('');
  const [doctors, setDoctors] = useState([]);
  const [patients, setPatients] = useState([]);
  const [fetching, setFetching] = useState(true);

  const selfDoctor = doctors.find((d) => d.doctor_id === user?.linked_id);

  // Visible text of the standalone patient search combobox — separate from
  // form.patient_id since the box displays "Name (ID: n)", not the bare id.
  const [patientSearchText, setPatientSearchText] = useState('');

  // Diagnosis dropdown — looked up by patient ID (known up front or typed in by the user)
  const [diagnosisOptions, setDiagnosisOptions] = useState([]);
  const [diagLoading,      setDiagLoading]      = useState(false);
  const [diagFetched,      setDiagFetched]      = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const fetchDiagnosesForPatient = (pid) => {
    if (!pid) return;
    setDiagLoading(true);
    getPatientHistory(pid)
      .then((res) => { if (res.success) setDiagnosisOptions(res.data.diagnoses ?? []); })
      .catch(() => setError('Failed to load diagnoses for that patient.'))
      .finally(() => { setDiagLoading(false); setDiagFetched(true); });
  };

  const handlePatientIdChange = (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, patient_id: value, diagnosis_id: '' }));
    setDiagnosisOptions([]);
    setDiagFetched(false);
  };

  const handlePatientIdBlur = () => fetchDiagnosesForPatient(form.patient_id);

  // Standalone mode (no patientId prop): selecting a suggestion from the
  // patient combobox resolves the typed label back to a patient_id.
  const handlePatientSelect = (e) => {
    const value = e.target.value;
    setPatientSearchText(value);
    const match = patients.find((p) => patientLabel(p) === value);
    if (match) {
      setForm((f) => ({ ...f, patient_id: match.patient_id, diagnosis_id: '' }));
      setDiagnosisOptions([]);
      setDiagFetched(false);
      fetchDiagnosesForPatient(match.patient_id);
    } else {
      setForm((f) => ({ ...f, patient_id: '', diagnosis_id: '' }));
      setDiagnosisOptions([]);
      setDiagFetched(false);
    }
  };

  // Load doctors when form mounts; also look up diagnoses for the patient
  // if one was already supplied (e.g. from PatientDetailPage)
  useEffect(() => {
    getActiveDoctors()
      .then((docRes) => { if (docRes.success) setDoctors(docRes.data); })
      .catch(() => setError('Failed to load doctors.'))
      .finally(() => setFetching(false));

    // Only standalone mode (opened from the Admissions page) needs the full
    // patient list — when patientId is passed, that patient is already fixed.
    if (!patientId) {
      getAllPatients({ limit: 1000 }).then((res) => { if (res.success) setPatients(res.data); });
    }

    if (form.patient_id) fetchDiagnosesForPatient(form.patient_id);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.patient_id || (!isDoctor && !form.doctor_id) || !form.admission_type) {
      setError('Patient ID, doctor, and admission type are required.');
      return;
    }
    setError('');
    onSubmit(form);
  };

  if (fetching) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      <div className="form-row">
        <div className="form-group">
          {patientId ? (
            <>
              <label htmlFor="af-pat">Patient ID *</label>
              <input
                id="af-pat"
                type="number"
                value={form.patient_id}
                onChange={handlePatientIdChange}
                onBlur={handlePatientIdBlur}
                placeholder="Patient ID"
                required
              />
            </>
          ) : (
            <>
              <label htmlFor="af-pat">Patient *</label>
              <input
                id="af-pat"
                list="af-patient-options"
                value={patientSearchText}
                onChange={handlePatientSelect}
                placeholder="Search patient by name"
                autoComplete="off"
                required
              />
              <datalist id="af-patient-options">
                {patients.map((p) => (
                  <option key={p.patient_id} value={patientLabel(p)} />
                ))}
              </datalist>
            </>
          )}
        </div>
        <div className="form-group">
          <label htmlFor="af-diag">Diagnosis</label>
          <div style={{ overflow: 'hidden', width: '100%' }}>
            <select
              id="af-diag"
              value={form.diagnosis_id}
              onChange={set('diagnosis_id')}
              size="1"
              style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              <option value="">— Select diagnosis —</option>
              {diagnosisOptions.map((d) => (
                <option key={d.diagnosis_id} value={d.diagnosis_id}>
                  {diagnosisLabel(d)}
                </option>
              ))}
            </select>
          </div>
          {diagLoading && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Loading diagnoses…
            </span>
          )}
          {!diagLoading && diagFetched && diagnosisOptions.length === 0 && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              No diagnoses recorded for this patient yet.
            </span>
          )}
        </div>
      </div>

      {/* Doctor dropdown — populated from /api/doctors/active */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        {isDoctor ? (
          <>
            <label htmlFor="af-doc">Admitting Doctor</label>
            <div
              id="af-doc"
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
              {selfDoctor ? `Dr. ${selfDoctor.first_name} ${selfDoctor.last_name} (You)` : 'Loading...'}
            </div>
          </>
        ) : (
          <>
            <label htmlFor="af-doc">Admitting Doctor *</label>
            <select id="af-doc" value={form.doctor_id} onChange={set('doctor_id')} required>
              <option value="">— Select doctor —</option>
              {doctors.map((d) => (
                <option key={d.doctor_id} value={d.doctor_id}>
                  Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
                </option>
              ))}
            </select>
            {doctors.length === 0 && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                No active doctors found.
              </span>
            )}
          </>
        )}
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="af-type">Admission Type *</label>
        <select id="af-type" value={form.admission_type} onChange={set('admission_type')} required>
          <option value="">— Select type —</option>
          {ADMISSION_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          Admit Patient
        </Button>
      </div>
    </form>
  );
};

export default AdmissionForm;
