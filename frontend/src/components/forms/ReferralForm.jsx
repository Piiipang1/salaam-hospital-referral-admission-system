import { useRef, useState, useEffect } from 'react';
import Button from '../ui/Button';
import Alert  from '../ui/Alert';
import Spinner from '../ui/Spinner';
import { getActiveDoctors } from '../../api/doctors.api';
import { getPatientHistory } from '../../api/patients.api';
import { useAuth } from '../../context/AuthContext';

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_MB  = 10;

// medical_condition can be a long clinical paragraph — keep dropdown options readable
const truncate = (str, n) => str?.length > n ? str.slice(0, n) + '…' : (str ?? '');

// Build the dropdown label for a diagnosis option — diagnosis ID is already unique, so skip the date
const diagnosisLabel = (d) => `Dx#${d.diagnosis_id} — ${truncate(d.medical_condition, 35)}`;

const ReferralForm = ({ diagnosisId, diagnoses, initial = {}, onSubmit, loading }) => {
  const { user } = useAuth();

  // Case A: `diagnoses` prop supplied (e.g. from PatientDetailPage — patient already known).
  // Case B: no `diagnoses` prop (e.g. from ReferralsPage, standalone) — look diagnoses up by patient ID.
  const standalone = diagnoses === undefined;

  const [form, setForm] = useState({
    diagnosis_id:        initial.diagnosis_id        ?? diagnosisId ?? '',
    referring_doctor_id: initial.referring_doctor_id ?? '',
    assigned_doctor_id:  initial.assigned_doctor_id  ?? '',
  });
  const [file,     setFile]     = useState(null);
  const [fileName, setFileName] = useState('');
  const [error,    setError]    = useState('');
  const [doctors,  setDoctors]  = useState([]);
  const [fetching, setFetching] = useState(true);
  const [hasSignature, setHasSignature] = useState(false);

  // ── Standalone mode (Case B) — patient lookup to populate the diagnosis dropdown ──
  const [patientId,        setPatientId]        = useState('');
  const [patientDiagnoses, setPatientDiagnoses] = useState([]);
  const [diagLoading,      setDiagLoading]      = useState(false);
  const [diagFetched,      setDiagFetched]      = useState(false);

  const diagnosisOptions = standalone ? patientDiagnoses : diagnoses;
  const selfDoctor = doctors.find((d) => d.doctor_id === user?.linked_id);

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

  // Look up a patient's diagnoses once they tab/click away from the Patient ID field
  const handlePatientIdChange = (e) => {
    setPatientId(e.target.value);
    setPatientDiagnoses([]);
    setDiagFetched(false);
    setForm((f) => ({ ...f, diagnosis_id: '' }));
  };

  const handlePatientIdBlur = () => {
    if (!patientId) return;
    setDiagLoading(true);
    getPatientHistory(patientId)
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

  // Load active doctors on mount
  useEffect(() => {
    getActiveDoctors()
      .then((res) => { if (res.success) setDoctors(res.data); })
      .catch(() => setError('Failed to load doctors list.'))
      .finally(() => setFetching(false));
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
    setError('');

    const fd = new FormData();
    fd.append('diagnosis_id',        String(form.diagnosis_id));
    fd.append('assigned_doctor_id',  String(form.assigned_doctor_id));
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
          <label htmlFor="rf-pat">Patient ID</label>
          <input
            id="rf-pat"
            type="number"
            value={patientId}
            onChange={handlePatientIdChange}
            onBlur={handlePatientIdBlur}
            placeholder="Enter patient ID to look up diagnoses"
          />
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

      {/* Fallback manual entry — standalone lookup found no diagnoses for that patient */}
      {standalone && diagFetched && diagnosisOptions.length === 0 && (
        <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
          <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-2)' }}>
            No diagnoses found for this patient.
          </p>
          <label htmlFor="rf-diag-fallback">Diagnosis ID *</label>
          <input
            id="rf-diag-fallback"
            type="number"
            value={form.diagnosis_id}
            onChange={set('diagnosis_id')}
            placeholder="Enter diagnosis ID manually"
            required
          />
        </div>
      )}

      {/* Referring doctor — a doctor is always their own referrer; only admin can pick one */}
      {user?.role === 'doctor' ? (
        <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
          <label htmlFor="rf-refdr">Referring Doctor</label>
          <span id="rf-refdr" className="text-sm">
            {selfDoctor ? `Dr. ${selfDoctor.first_name} ${selfDoctor.last_name} (You)` : 'Loading...'}
          </span>
        </div>
      ) : (
        <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
          <label htmlFor="rf-refdr">Referring Doctor</label>
          <select id="rf-refdr" value={form.referring_doctor_id} onChange={set('referring_doctor_id')}>
            <option value="">— None / Unknown —</option>
            {doctors.map((d) => (
              <option key={d.doctor_id} value={d.doctor_id}>
                Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Assigned doctor */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="rf-assdr">Assigned Doctor *</label>
        <select id="rf-assdr" value={form.assigned_doctor_id} onChange={set('assigned_doctor_id')} required>
          <option value="">— Select doctor to receive referral —</option>
          {doctors.map((d) => (
            <option key={d.doctor_id} value={d.doctor_id}>
              Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
            </option>
          ))}
        </select>
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
            📎 {file ? 'Change File' : 'Attach Document'}
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
