import { useState, useEffect } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { getActiveDoctors } from '../../api/doctors.api';

const DISPOSITIONS = ['Admit', 'Discharge', 'Refer', 'Observe'];

const DoctorAssessmentForm = ({ initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    doctor_id:      initial.doctor_id      ?? '',
    clinical_notes: initial.clinical_notes ?? '',
    disposition:    initial.disposition    ?? '',
  });
  const [error,   setError]   = useState('');
  const [doctors, setDoctors] = useState([]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    getActiveDoctors()
      .then((res) => { if (res.success) setDoctors(res.data); })
      .catch(() => setError('Failed to load doctors list.'));
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.doctor_id || !form.disposition) {
      setError('Assessing doctor and disposition are required.');
      return;
    }
    setError('');
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      {/* ── Assessing doctor ── */}
      <div className="form-group">
        <label htmlFor="daf-doc">Assessing Doctor *</label>
        <select id="daf-doc" value={form.doctor_id} onChange={set('doctor_id')} required>
          <option value="">— Select doctor —</option>
          {doctors.map((d) => (
            <option key={d.doctor_id} value={d.doctor_id}>
              Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* ── Disposition ── */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="daf-disposition">Disposition *</label>
        <select id="daf-disposition" value={form.disposition} onChange={set('disposition')} required>
          <option value="">— Select disposition —</option>
          {DISPOSITIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* ── Clinical notes ── */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="daf-notes">Clinical Notes</label>
        <textarea
          id="daf-notes"
          value={form.clinical_notes}
          onChange={set('clinical_notes')}
          rows={5}
          placeholder="Document clinical assessment, care plan, and rationale for disposition..."
        />
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          {initial.assessment_id ? 'Update Assessment' : 'Add Assessment'}
        </Button>
      </div>
    </form>
  );
};

export default DoctorAssessmentForm;
