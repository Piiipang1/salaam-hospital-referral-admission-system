import { useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { TRIAGE_LEVELS } from '../../utils/constants';

const TriageForm = ({ patientId, initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    patient_id:    initial.patient_id    ?? patientId ?? '',
    triage_level:  initial.triage_level  ?? '',
    notes:         initial.notes         ?? '',
    visit_room_id: initial.visit_room_id ?? '',
    employee_id:   initial.employee_id   ?? '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.triage_level) { setError('Triage level is required.'); return; }
    setError('');
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      <div className="form-group">
        <label htmlFor="tf-level">Triage Level *</label>
        <select id="tf-level" value={form.triage_level} onChange={set('triage_level')} required>
          <option value="">Select triage level</option>
          {TRIAGE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="tf-room">Visit Room ID</label>
          <input id="tf-room" type="number" value={form.visit_room_id} onChange={set('visit_room_id')} placeholder="Optional room ID" />
        </div>
        <div className="form-group">
          <label htmlFor="tf-emp">Employee ID (Nurse)</label>
          <input id="tf-emp" type="number" value={form.employee_id} onChange={set('employee_id')} placeholder="Optional employee ID" />
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="tf-notes">Clinical Notes</label>
        <textarea id="tf-notes" value={form.notes} onChange={set('notes')} rows={4} placeholder="Describe chief complaint, initial assessment..." />
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>
          {initial.triage_id ? 'Update Triage' : 'Record Triage'}
        </Button>
      </div>
    </form>
  );
};

export default TriageForm;
