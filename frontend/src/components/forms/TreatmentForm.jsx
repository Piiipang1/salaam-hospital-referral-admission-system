import { useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { formatDate } from '../../utils/formatDate';

// medical_condition can be a long clinical paragraph — keep dropdown options readable
const truncate = (str, n) => str?.length > n ? str.slice(0, n) + '…' : (str ?? '');

const TreatmentForm = ({ diagnoses = [], initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    diagnosis_id:           initial.diagnosis_id           ?? '',
    prescribed_medications: initial.prescribed_medications ?? '',
    dosage:                 initial.dosage                 ?? '',
    frequency:              initial.frequency               ?? '',
    treatment_duration:     initial.treatment_duration       ?? '',
  });
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.diagnosis_id || !form.prescribed_medications.trim()) {
      setError('Diagnosis and medication name are required.');
      return;
    }
    setError('');
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      {/* ── Linked diagnosis ── */}
      <div className="form-group">
        <label htmlFor="tf-diag">Diagnosis *</label>
        <select id="tf-diag" value={form.diagnosis_id} onChange={set('diagnosis_id')} required>
          <option value="">— Select diagnosis —</option>
          {diagnoses.map((d) => (
            <option key={d.diagnosis_id} value={d.diagnosis_id}>
              {formatDate(d.diagnosis_date)} — {truncate(d.medical_condition, 35)}
            </option>
          ))}
        </select>
      </div>

      {/* ── Medication ── */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="tf-med">Medication Name *</label>
        <input
          id="tf-med"
          type="text"
          value={form.prescribed_medications}
          onChange={set('prescribed_medications')}
          placeholder="e.g. Amoxicillin"
          required
        />
      </div>

      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="tf-dosage">Dosage</label>
          <input id="tf-dosage" type="text" value={form.dosage} onChange={set('dosage')} placeholder="e.g. 500mg" />
        </div>
        <div className="form-group">
          <label htmlFor="tf-freq">Frequency</label>
          <input id="tf-freq" type="text" value={form.frequency} onChange={set('frequency')} placeholder="e.g. Twice daily" />
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="tf-duration">Treatment Duration</label>
        <input
          id="tf-duration"
          type="text"
          value={form.treatment_duration}
          onChange={set('treatment_duration')}
          placeholder="e.g. 7 days, Ongoing — follow up in 1 week"
        />
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          {initial.treatment_id ? 'Update Treatment' : 'Add Treatment'}
        </Button>
      </div>
    </form>
  );
};

export default TreatmentForm;
