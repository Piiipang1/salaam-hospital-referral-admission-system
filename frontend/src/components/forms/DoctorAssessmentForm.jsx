import { useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';

const DISPOSITIONS = ['Admit', 'Discharge', 'Refer', 'Observe'];

const DoctorAssessmentForm = ({ initial = {}, onSubmit, loading, currentDoctorId }) => {
  const [form, setForm] = useState({
    doctor_id:      currentDoctorId ?? '',
    clinical_notes: initial.clinical_notes ?? '',
    disposition:    initial.disposition    ?? '',
  });
  const [error,   setError]   = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.disposition) {
      setError('Disposition is required.');
      return;
    }
    setError('');
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

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
