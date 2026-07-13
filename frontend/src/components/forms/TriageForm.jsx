import { useState, useEffect } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { TRIAGE_LEVELS } from '../../utils/constants';
import { useAuth } from '../../context/AuthContext';
import { getActiveEmployees } from '../../api/employees.api';
import { getAllPatients } from '../../api/patients.api';
import { getVisitRoomOptions } from '../../api/triages.api';
import { patientLabel } from '../../utils/patientLabels';

const TriageForm = ({ patientId, initial = {}, onSubmit, loading }) => {
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
  const [patients,          setPatients]          = useState([]);
  const [visitRooms,        setVisitRooms]        = useState([]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Load active employees and (standalone only) patients on mount
  useEffect(() => {
    getActiveEmployees()
      .then((res) => { if (res.success) setEmployees(res.data); })
      .catch(() => setError('Failed to load employees list.'))
      .finally(() => setEmployeesFetching(false));

    if (!patientId) {
      getAllPatients({ limit: 1000 }).then((res) => { if (res.success) setPatients(res.data); });
    }

    getVisitRoomOptions()
      .then((res) => { if (res.success) setVisitRooms(res.data); })
      .catch(() => {});
  }, []);

  const selfEmployee = employees.find((e) => e.employee_id === user?.linked_id);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!patientId && !form.patient_id) { setError('Patient is required.'); return; }
    if (!form.triage_level) { setError('Triage level is required.'); return; }
    setError('');

    if (user?.role === 'nurse' || user?.role === 'staff') {
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
          <select id="tf-patient" value={form.patient_id} onChange={set('patient_id')} required>
            <option value="">— Select patient —</option>
            {patients.map((p) => (
              <option key={p.patient_id} value={p.patient_id}>
                {patientLabel(p, patients)}{p.is_unidentified ? ' ⚠ Unidentified' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="tf-level">Triage Level *</label>
        <select id="tf-level" value={form.triage_level} onChange={set('triage_level')} required>
          <option value="">Select triage level</option>
          {TRIAGE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
        <div className="form-group">
          <label htmlFor="tf-room">Visit Room (optional)</label>
          <select id="tf-room" value={form.visit_room_id} onChange={set('visit_room_id')}>
            <option value="">— None —</option>
            {visitRooms.map((vr) => (
              <option key={vr.visit_room_id} value={vr.visit_room_id}>{vr.room_label}</option>
            ))}
          </select>
        </div>
        {(user?.role === 'nurse' || user?.role === 'staff') ? (
          <div className="form-group">
            <label htmlFor="tf-emp">Attending Nurse / Staff</label>
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
            <label htmlFor="tf-emp">Attending Nurse / Staff</label>
            <select id="tf-emp" value={form.employee_id} onChange={set('employee_id')}>
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
