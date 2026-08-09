import { useRef, useState, useEffect } from 'react';
import { Paperclip } from 'lucide-react';
import Button from '../ui/Button';
import Alert  from '../ui/Alert';
import Spinner from '../ui/Spinner';
import { getActiveDoctors } from '../../api/doctors.api';
import { getPatientHistory, getAllPatients } from '../../api/patients.api';
import { useAuth } from '../../context/AuthContext';
import { patientLabel, findPatientByLabel } from '../../utils/patientLabels';
import { formatDate } from '../../utils/formatDate';

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_MB  = 10;

// medical_condition can be a long clinical paragraph — keep dropdown options readable
const truncate = (str, n) => str?.length > n ? str.slice(0, n) + '…' : (str ?? '');

// Build the dropdown label for a diagnosis option — date + condition, no internal id
const diagnosisLabel = (d) => `${formatDate(d.diagnosis_date)} — ${truncate(d.medical_condition, 35)}`;

const ReferralForm = ({ diagnosisId, diagnoses, initial = {}, onSubmit, loading }) => {
  const { user } = useAuth();

  // Case A: `diagnoses` prop supplied (e.g. from PatientDetailPage — patient already known).
  // Case B: no `diagnoses` prop (e.g. from ReferralsPage, standalone) — look diagnoses up by patient ID.
  const standalone = diagnoses === undefined;

  const [form, setForm] = useState({
    diagnosis_id:        initial.diagnosis_id        ?? diagnosisId ?? '',
    referring_doctor_id: initial.referring_doctor_id ?? '',
    assigned_doctor_id:  initial.assigned_doctor_id  ?? '',
    remarks:             initial.remarks             ?? '',
  });
  const [file,     setFile]     = useState(null);
  const [fileName, setFileName] = useState('');
  const [error,    setError]    = useState('');
  const [doctors,  setDoctors]  = useState([]);
  const [fetching, setFetching] = useState(true);
  const [hasSignature, setHasSignature] = useState(false);

  // ── Standalone mode (Case B) — patient lookup to populate the diagnosis dropdown ──
  const [patients,          setPatients]          = useState([]);
  const [patientSearchText, setPatientSearchText] = useState('');
  const [patientDiagnoses,  setPatientDiagnoses]  = useState([]);
  const [diagLoading,       setDiagLoading]       = useState(false);
  const [diagFetched,       setDiagFetched]       = useState(false);

  const diagnosisOptions = standalone ? patientDiagnoses : diagnoses;
  const selfDoctor = doctors.find((d) => d.doctor_id === user?.linked_id);

  // A referral must go to a DIFFERENT doctor, so hide the impossible option from
  // "Refer To": a doctor's own id, or (for an admin) whoever is selected in
  // "Referred By". Backend enforces this too — the filter is just UX.
  const excludedReferToId = user?.role === 'doctor'
    ? user?.linked_id
    : (form.referring_doctor_id !== '' ? Number(form.referring_doctor_id) : null);

  // The referring doctor's specialty decides who is a valid target: a referral
  // must reach someone who can treat what this doctor cannot, so colleagues in
  // the SAME specialty are not referral targets (that is a reassignment).
  // Backend enforces this too — the filter is UX, and the count below explains
  // the omission rather than silently shortening the list.
  const referrer = user?.role === 'doctor'
    ? selfDoctor
    : doctors.find((d) => Number(d.doctor_id) === Number(form.referring_doctor_id));
  const referrerSpecialty = referrer?.specialization?.trim().toLowerCase() ?? null;

  const sameSpecialtyAsReferrer = (d) =>
    !!referrerSpecialty &&
    !!d.specialization &&
    d.specialization.trim().toLowerCase() === referrerSpecialty;

  const candidateDoctors = doctors.filter((d) => Number(d.doctor_id) !== Number(excludedReferToId));
  const referToDoctors   = candidateDoctors.filter((d) => !sameSpecialtyAsReferrer(d));
  const hiddenSameSpecialty = candidateDoctors.length - referToDoctors.length;

  // An admin switching "Referred By" can invalidate an already-chosen target
  // (same specialty as the new referrer). Drop it rather than submit a value the
  // API will reject and the dropdown no longer shows.
  useEffect(() => {
    if (!form.assigned_doctor_id) return;
    const stillValid = referToDoctors.some(
      (d) => Number(d.doctor_id) === Number(form.assigned_doctor_id)
    );
    if (!stillValid) setForm((f) => ({ ...f, assigned_doctor_id: '' }));
  }, [form.referring_doctor_id, doctors]);

  const fileRef     = useRef(null);
  const canvasRef   = useRef(null);
  const drawingRef  = useRef(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Auto-select when exactly one diagnosis is available
  useEffect(() => {
    if (diagnosisOptions?.length === 1) {
      setForm((f) => ({ ...f, diagnosis_id: diagnosisOptions[0].diagnosis_id }));
    }
  }, [diagnosisOptions]);

  // Selecting a suggestion from the patient combobox resolves the typed label
  // back to a patient record, then loads that patient's diagnoses.
  const handlePatientSelect = (e) => {
    const value = e.target.value;
    setPatientSearchText(value);
    setPatientDiagnoses([]);
    setDiagFetched(false);
    setForm((f) => ({ ...f, diagnosis_id: '' }));

    const match = findPatientByLabel(patients, value);
    if (!match) return;
    setDiagLoading(true);
    getPatientHistory(match.patient_id)
      .then((res) => { if (res.success) setPatientDiagnoses(res.data.diagnoses ?? []); })
      .catch(() => setError('Failed to load diagnoses for that patient.'))
      .finally(() => { setDiagLoading(false); setDiagFetched(true); });
  };

  // ── Signature canvas — white background + black ink, set up once ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.strokeStyle = '#1e293b';
  }, []);

  // Map a mouse/touch event to canvas-relative coordinates
  const getCanvasPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return {
      x: (point.clientX - rect.left) * (canvas.width  / rect.width),
      y: (point.clientY - rect.top)  * (canvas.height / rect.height),
    };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
  };

  const draw = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getCanvasPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => { drawingRef.current = false; };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  // Load active doctors on mount; standalone mode also needs the patient list
  // to power the searchable name combobox
  useEffect(() => {
    getActiveDoctors()
      .then((res) => { if (res.success) setDoctors(res.data); })
      .catch(() => setError('Failed to load doctors list.'))
      .finally(() => setFetching(false));

    if (standalone) {
      getAllPatients({ limit: 1000 }).then((res) => { if (res.success) setPatients(res.data); });
    }
  }, []);

  // ── File validation ────────────────────────────────────────────
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

  // ── Submit — build FormData so multer can parse it ─────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.diagnosis_id || !form.assigned_doctor_id) {
      setError('Diagnosis and assigned doctor are required.');
      return;
    }
    // Mirrors the API's rule so the user is told before a round trip.
    const remarks = form.remarks.trim();
    if (!remarks) {
      setError('Notes/Remarks are required — state why this patient needs another doctor.');
      return;
    }
    if (remarks.length < 10) {
      setError('Notes/Remarks must be at least 10 characters — briefly describe why the referral is needed.');
      return;
    }
    setError('');

    const fd = new FormData();
    fd.append('diagnosis_id',        String(form.diagnosis_id));
    fd.append('assigned_doctor_id',  String(form.assigned_doctor_id));
    fd.append('remarks',             remarks);
    if (user?.role !== 'doctor' && form.referring_doctor_id) {
      fd.append('referring_doctor_id', String(form.referring_doctor_id));
    }
    if (file) {
      fd.append('file_attachment', file);
    }
    if (hasSignature) {
      fd.append('e_signature', canvasRef.current.toDataURL('image/png'));
    }

    onSubmit(fd);
  };

  if (fetching) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      {/* Patient lookup — standalone mode only (no diagnoses prop supplied) */}
      {standalone && (
        <div className="form-group">
          <label htmlFor="rf-pat">Patient</label>
          <input
            id="rf-pat"
            list="rf-patient-options"
            value={patientSearchText}
            onChange={handlePatientSelect}
            placeholder="Search patient by name"
            autoComplete="off"
          />
          <datalist id="rf-patient-options">
            {patients.map((p) => (
              <option key={p.patient_id} value={patientLabel(p, patients)} />
            ))}
          </datalist>
          {diagLoading && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Loading diagnoses…
            </span>
          )}
        </div>
      )}

      {/* Diagnosis dropdown — Case A (diagnoses prop) or Case B (fetched via patient lookup) */}
      {(!standalone || diagnosisOptions.length > 0) && (
        <div className="form-group" style={{ marginTop: standalone ? 'var(--space-4)' : 0 }}>
          <label htmlFor="rf-diag">Diagnosis *</label>
          <div style={{ overflow: 'hidden', width: '100%' }}>
            <select
              id="rf-diag"
              value={form.diagnosis_id}
              onChange={set('diagnosis_id')}
              size="1"
              style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              required
            >
              <option value="">— Select diagnosis —</option>
              {diagnosisOptions.map((d) => (
                <option key={d.diagnosis_id} value={d.diagnosis_id}>
                  {diagnosisLabel(d)}
                </option>
              ))}
            </select>
          </div>
          {!standalone && diagnosisOptions.length === 0 && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              No diagnoses recorded for this patient yet.
            </span>
          )}
        </div>
      )}

      {/* Standalone lookup found no diagnoses — a referral needs one, so point the user there */}
      {standalone && diagFetched && diagnosisOptions.length === 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Alert type="info" message="This patient has no recorded diagnoses yet — create a diagnosis first." />
        </div>
      )}

      {/* Referring doctor — a doctor is always their own referrer; only admin can pick one */}
      {user?.role === 'doctor' ? (
        <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
          <label htmlFor="rf-refdr">Referred By</label>
          <span id="rf-refdr" className="text-sm">
            {selfDoctor ? `Dr. ${selfDoctor.first_name} ${selfDoctor.last_name} (You)` : 'Loading...'}
          </span>
        </div>
      ) : (
        <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
          <label htmlFor="rf-refdr">Referred By</label>
          <select
            id="rf-refdr"
            value={form.referring_doctor_id}
            onChange={(e) => {
              // Admin edge case: if the new referrer is already selected in
              // "Refer To", clear it so the two can never be equal (the option
              // filter alone would leave a stale value behind).
              const newReferrer = e.target.value;
              setForm((f) => ({
                ...f,
                referring_doctor_id: newReferrer,
                assigned_doctor_id:
                  newReferrer !== '' && Number(f.assigned_doctor_id) === Number(newReferrer)
                    ? ''
                    : f.assigned_doctor_id,
              }));
            }}
          >
            <option value="">— None / Unknown —</option>
            {doctors.map((d) => (
              <option key={d.doctor_id} value={d.doctor_id}>
                Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Refer To — must differ from Referred By AND be a different specialty */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="rf-assdr">Refer To *</label>
        <select id="rf-assdr" value={form.assigned_doctor_id} onChange={set('assigned_doctor_id')} required>
          <option value="">— Select doctor to receive referral —</option>
          {referToDoctors.map((d) => (
            <option key={d.doctor_id} value={d.doctor_id}>
              Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
            </option>
          ))}
        </select>
        {hiddenSameSpecialty > 0 && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {hiddenSameSpecialty} {referrer?.specialization} doctor{hiddenSameSpecialty !== 1 ? 's are' : ' is'} not
            listed — a referral must reach a specialty that can treat what you cannot.
          </span>
        )}
        {referToDoctors.length === 0 && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>
            No doctor of another specialty is available to receive this referral.
          </span>
        )}
      </div>

      {/* Notes / Remarks — mandatory. The receiving doctor is picking up a
          patient they have not been managing; this is where they learn why. */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="rf-remarks">Notes / Remarks *</label>
        <textarea
          id="rf-remarks"
          rows={4}
          value={form.remarks}
          onChange={set('remarks')}
          placeholder="Why does this patient need another specialty? Findings so far, what has been tried, and what you are asking for."
          required
        />
        <span style={{
          fontSize: 'var(--font-size-xs)',
          color: form.remarks.trim().length > 0 && form.remarks.trim().length < 10
            ? 'var(--color-danger)'
            : 'var(--color-text-muted)',
        }}>
          Required — at least 10 characters. {form.remarks.trim().length}/2000
        </span>
      </div>

      {/* ── File attachment (optional) ───────────────────────────── */}
      <div className="lab-upload-section">
        <p className="lab-upload-heading">
          Referral Document&nbsp;
          <span className="lab-upload-optional">(optional — PDF or image, max {MAX_SIZE_MB} MB)</span>
        </p>
        <div className="file-input-wrapper">
          <button
            type="button"
            className="file-input-btn"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={14} /> {file ? 'Change File' : 'Attach Document'}
          </button>
          <span className="file-input-name">{fileName || 'No file chosen'}</span>
          {file && (
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 'var(--font-size-xs)' }}
              onClick={() => { setFile(null); setFileName(''); if (fileRef.current) fileRef.current.value = ''; }}
              title="Remove attachment"
            >
              ✕
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* ── Doctor's signature (optional) ────────────────────────── */}
      <div className="lab-upload-section">
        <p className="lab-upload-heading">
          Doctor&apos;s Signature&nbsp;
          <span className="lab-upload-optional">(optional — draw with mouse or touch)</span>
        </p>
        <canvas
          ref={canvasRef}
          width={400}
          height={150}
          className="signature-canvas"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        <div className="signature-actions">
          <button type="button" className="file-input-btn" onClick={clearSignature}>
            Clear
          </button>
        </div>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          Create Referral
        </Button>
      </div>
    </form>
  );
};

export default ReferralForm;
