import { useRef, useState, useEffect } from 'react';
import Button from '../ui/Button';
import Alert  from '../ui/Alert';
import Spinner from '../ui/Spinner';
import { getActiveDoctors } from '../../api/doctors.api';

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE_MB  = 10;

const ReferralForm = ({ diagnosisId, initial = {}, onSubmit, loading }) => {
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

  const fileRef = useRef(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

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
      setError('Diagnosis ID and assigned doctor are required.');
      return;
    }
    setError('');

    const fd = new FormData();
    fd.append('diagnosis_id',        String(form.diagnosis_id));
    fd.append('assigned_doctor_id',  String(form.assigned_doctor_id));
    if (form.referring_doctor_id) {
      fd.append('referring_doctor_id', String(form.referring_doctor_id));
    }
    if (file) {
      fd.append('file_attachment', file);
    }

    onSubmit(fd);
  };

  if (fetching) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      {/* Diagnosis ID */}
      <div className="form-group">
        <label htmlFor="rf-diag">Diagnosis ID *</label>
        <input
          id="rf-diag"
          type="number"
          value={form.diagnosis_id}
          onChange={set('diagnosis_id')}
          placeholder="Linked diagnosis ID"
          required
        />
      </div>

      {/* Referring doctor */}
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

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          Create Referral
        </Button>
      </div>
    </form>
  );
};

export default ReferralForm;
