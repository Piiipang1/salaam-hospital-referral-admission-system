import { useRef, useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { toInputDate } from '../../utils/formatDate';
import { addLabResult } from '../../api/diagnoses.api';

const DiagnosisForm = ({ patientId, triageId, initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    patient_id:        initial.patient_id        ?? patientId ?? '',
    triage_id:         initial.triage_id         ?? triageId  ?? '',
    doctor_id:         initial.doctor_id         ?? '',
    medical_condition: initial.medical_condition ?? '',
    diagnosis_date:    initial.diagnosis_date ? toInputDate(initial.diagnosis_date) : toInputDate(new Date()),
  });
  const [testType,     setTestType]     = useState('');
  const [labFile,      setLabFile]      = useState(null);
  const [labFileName,  setLabFileName]  = useState('');
  const [labUploading, setLabUploading] = useState(false);
  const [error,        setError]        = useState('');
  const fileInputRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) { setLabFile(null); setLabFileName(''); return; }
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setError('Only PDF and image files (JPG, PNG, WebP, GIF) are allowed.');
      e.target.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must not exceed 10 MB.');
      e.target.value = '';
      return;
    }
    setError('');
    setLabFile(file);
    setLabFileName(file.name);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.doctor_id || !form.medical_condition || !form.diagnosis_date) {
      setError('Doctor ID, medical condition, and diagnosis date are required.');
      return;
    }
    if (labFile && !testType.trim()) {
      setError('Please enter a test type / label for the uploaded lab file.');
      return;
    }
    setError('');

    // 1. Create / update the diagnosis (onSubmit returns the response)
    let diagnosisId = initial.diagnosis_id ?? null;
    try {
      const result = await Promise.resolve(onSubmit(form));
      // If the parent returned the new diagnosis_id, capture it
      if (result?.diagnosis_id) diagnosisId = result.diagnosis_id;
    } catch {
      return; // parent already handles the error display
    }

    // 2. If a lab file was chosen and we have a diagnosis_id, upload it
    if (labFile && diagnosisId) {
      setLabUploading(true);
      try {
        const fd = new FormData();
        fd.append('file_attachment', labFile);
        fd.append('patient_id',     String(form.patient_id || patientId || ''));
        fd.append('test_type',      testType.trim());
        await addLabResult(diagnosisId, fd);
      } catch {
        setError('Diagnosis saved but the lab file could not be uploaded. Please try again from the Diagnoses tab.');
      } finally {
        setLabUploading(false);
      }
    }
  };

  const isSubmitting = loading || labUploading;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      {/* ── Core diagnosis fields ── */}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="df-doc">Doctor ID *</label>
          <input id="df-doc" type="number" value={form.doctor_id} onChange={set('doctor_id')} placeholder="e.g. 1" required />
        </div>
        <div className="form-group">
          <label htmlFor="df-date">Diagnosis Date *</label>
          <input id="df-date" type="date" value={form.diagnosis_date} onChange={set('diagnosis_date')} required />
        </div>
      </div>
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="df-condition">Medical Condition / Findings *</label>
        <textarea id="df-condition" value={form.medical_condition} onChange={set('medical_condition')}
          rows={5} placeholder="Describe diagnosis, clinical findings, and impression..." required />
      </div>

      {/* ── Lab Result Attachment (optional) ── */}
      <div className="lab-upload-section">
        <p className="lab-upload-heading">Lab Result Attachment <span className="lab-upload-optional">(optional)</span></p>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="df-test-type">Test Type / Label</label>
            <input
              id="df-test-type"
              type="text"
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
              placeholder="e.g. CBC, X-Ray, Urinalysis"
            />
          </div>
          <div className="form-group">
            <label htmlFor="df-lab-file">File (PDF or Image, max 10 MB)</label>
            <div className="file-input-wrapper">
              <button
                type="button"
                className="file-input-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-describedby="df-lab-file-name"
              >
                📎 Choose File
              </button>
              <span id="df-lab-file-name" className="file-input-name">
                {labFileName || 'No file chosen'}
              </span>
              <input
                ref={fileInputRef}
                id="df-lab-file"
                type="file"
                accept="application/pdf,image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {isSubmitting && labUploading
            ? 'Uploading file…'
            : initial.diagnosis_id ? 'Update Diagnosis' : 'Record Diagnosis'}
        </Button>
      </div>
    </form>
  );
};

export default DiagnosisForm;
