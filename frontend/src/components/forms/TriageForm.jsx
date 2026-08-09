import { useState, useEffect } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { TRIAGE_LEVELS } from '../../utils/constants';
import { useAuth } from '../../context/AuthContext';
import { getActiveEmployees } from '../../api/employees.api';
import { getVisitRoomOptions } from '../../api/triages.api';
import PatientTypeahead from '../ui/PatientTypeahead';

// `disabled` locks every field and the submit button — used by the capacity
// control when the hospital has no available rooms.
const TriageForm = ({ patientId, initial = {}, onSubmit, loading, disabled = false }) => {
  const { user } = useAuth();
  const [form, setForm] = useState({
    patient_id:          initial.patient_id          ?? patientId ?? '',
    triage_level:        initial.triage_level        ?? '',
    notes:               initial.notes               ?? '',
    visit_room_id:       initial.visit_room_id       ?? '',
    employee_id:         initial.employee_id         ?? '',
  });
  const [error, setError] = useState('');
  const [employees,         setEmployees]         = useState([]);
  const [employeesFetching, setEmployeesFetching] = useState(true);
  const [visitRooms,        setVisitRooms]        = useState([]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Patients are no longer bulk-loaded here — PatientTypeahead queries
  // /api/patients/search as the nurse types, so opening this form costs one
  // small request instead of pulling the whole patient table into the browser.
  useEffect(() => {
    getActiveEmployees()
      .then((res) => { if (res.success) setEmployees(res.data); })
      .catch(() => setError('Failed to load employees list.'))
      .finally(() => setEmployeesFetching(false));

    getVisitRoomOptions()
      .then((res) => { if (res.success) setVisitRooms(res.data); })
      .catch(() => {});
  }, []);

  const selfEmployee = employees.find((e) => e.employee_id === user?.linked_id);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (disabled) return;
    if (!patientId && !form.patient_id) { setError('Patient is required.'); return; }
    if (!form.triage_level) { setError('Triage level is required.'); return; }
    setError('');

    if (user?.role === 'nurse') {
      const { employee_id, ...rest } = form;
      onSubmit(rest);
    } else {
      onSubmit(form);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      {!patientId && (
        <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
          <label htmlFor="tf-patient">Patient *</label>
          <PatientTypeahead
            id="tf-patient"
            value={form.patient_id}
            disabled={disabled}
            required
            onChange={(p) => setForm((f) => ({ ...f, patient_id: p?.patient_id ?? '' }))}
          />
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            Type a name in any order, or the patient's ID number.
          </span>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="tf-level">Triage Level *</label>
        <select id="tf-level" value={form.triage_level} onChange={set('triage_level')} required disabled={disabled}>
          <option value="">Select triage level</option>
          {TRIAGE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="tf-room">Visit Room (optional)</label>
          <select id="tf-room" value={form.visit_room_id} onChange={set('visit_room_id')} disabled={disabled}>
            <option value="">— None —</option>
            {visitRooms.map((vr) => (
              <option key={vr.visit_room_id} value={vr.visit_room_id}>{vr.room_label}</option>
            ))}
          </select>
        </div>
        {(user?.role === 'nurse') ? (
          <div className="form-group">
            <label htmlFor="tf-emp">Attending Nurse</label>
            <input
              id="tf-emp"
              type="text"
              value={
                employeesFetching
                  ? 'Loading...'
                  : selfEmployee
                    ? `${selfEmployee.first_name} ${selfEmployee.last_name} (You)`
                    : 'Loading...'
              }
              disabled
            />
          </div>
        ) : (
          <div className="form-group">
            <label htmlFor="tf-emp">Attending Nurse</label>
            <select id="tf-emp" value={form.employee_id} onChange={set('employee_id')} disabled={disabled}>
              <option value="">— Select employee (optional) —</option>
              {employees.map((e) => (
                <option key={e.employee_id} value={e.employee_id}>
                  {e.first_name} {e.last_name} ({e.role})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="tf-notes">Clinical Notes</label>
        <textarea id="tf-notes" value={form.notes} onChange={set('notes')} rows={4} placeholder="Describe chief complaint, initial assessment..." disabled={disabled} />
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading} disabled={disabled}>
          {initial.triage_id ? 'Update Triage' : 'Record Triage'}
        </Button>
      </div>
    </form>
  );
};

export default TriageForm;
