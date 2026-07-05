import { useState } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';

const VitalSignsForm = ({ triageId, initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    blood_pressure:   initial.blood_pressure   ?? '',
    heart_rate:       initial.heart_rate       ?? '',
    temperature:      initial.temperature      ?? '',
    respiratory_rate: initial.respiratory_rate ?? '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.blood_pressure || !form.heart_rate || !form.temperature || !form.respiratory_rate) {
      setError('All vital sign fields are required.');
      return;
    }
    setError('');
    onSubmit(form);
  };

  const helperStyle = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-text-muted)',
    marginTop: '4px',
    display: 'block',
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="vs-bp">Blood Pressure (mmHg) *</label>
          <input id="vs-bp" value={form.blood_pressure} onChange={set('blood_pressure')} placeholder="e.g. 120/80" required />
          <span style={helperStyle}>Normal: 90/60 – 120/80 mmHg</span>
        </div>
        <div className="form-group">
          <label htmlFor="vs-hr">Heart Rate (bpm) *</label>
          <input id="vs-hr" type="number" value={form.heart_rate} onChange={set('heart_rate')} placeholder="e.g. 72" min="1" max="300" required />
          <span style={helperStyle}>Normal: 60 – 100 bpm</span>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="vs-temp">Temperature (°C) *</label>
          <input id="vs-temp" type="number" step="0.1" value={form.temperature} onChange={set('temperature')} placeholder="e.g. 37.0" required />
          <span style={helperStyle}>Normal: 36.1 – 37.2 °C</span>
        </div>
        <div className="form-group">
          <label htmlFor="vs-rr">Respiratory Rate (breaths/min) *</label>
          <input id="vs-rr" type="number" value={form.respiratory_rate} onChange={set('respiratory_rate')} placeholder="e.g. 16" min="1" max="100" required />
          <span style={helperStyle}>Normal: 12 – 20 breaths/min</span>
        </div>
      </div>
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading}>Save Vital Signs</Button>
      </div>
    </form>
  );
};

export default VitalSignsForm;
