import { useState, useEffect } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import { TRIAGE_LEVELS } from '../../utils/constants';
import { useAuth } from '../../context/AuthContext';
import { getActiveEmployees } from '../../api/employees.api';
import { getActiveDoctors } from '../../api/doctors.api';
import { getAllPatients } from '../../api/patients.api';

const TriageForm = ({ patientId, initial = {}, onSubmit, loading }) => {
  const { user } = useAuth();
  const [form, setForm] = useState({
    patient_id:          initial.patient_id          ?? patientId ?? '',
    triage_level:        initial.triage_level        ?? '',
    notes:               initial.notes               ?? '',
    visit_room_id:       initial.visit_room_id       ?? '',
    employee_id:         initial.employee_id         ?? '',
    assigned_doctor_id:  initial.assigned_doctor_id  ?? '',
  });
  const [error, setError] = useState('');
  const [employees,         setEmployees]         = useState([]);
  const [employeesFetching, setEmployeesFetching] = useState(true);
  const [doctors,           setDoctors]           = useState([]);
  const [doctorsFetching,   setDoctorsFetching]   = useState(true);
  const [patients,          setPatients]          = useState([]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Load active employees, doctors, and (standalone only) patients on mount
  useEffect(() => {
    getActiveEmployees()
      .then((res) => { if (res.success) setEmployees(res.data); })
      .catch(() => setError('Failed to load employees list.'))
      .finally(() => setEmployeesFetching(false));

    getActiveDoctors()
      .then((res) => { if (res.success) setDoctors(res.data); })
      .catch(() => {})
      .finally(() => setDoctorsFetching(false));

    if (!patientId) {
      getAllPatients({ limit: 1000 }).then((res) => { if (res.success) setPatients(res.data); });
    }
  }, []);

  const selfEmployee = employees.find((e) => e.employee_id === user?.linked_id);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!patientId && !form.patient_id) { setError('Patient is required.'); return; }
    if (!form.triage_level) { setError('Triage level is required.'); return; }
    if (!form.assigned_doctor_id) { setError('An attending doctor must be assigned.'); return; }
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
                {p.first_name} {p.last_name} (ID: {p.patient_id}){p.is_unidentified ? ' ⚠ Unidentified' : ''}
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
          <label htmlFor="tf-room">Visit Room ID</label>
          <input id="tf-room" type="number" value={form.visit_room_id} onChange={set('visit_room_id')} placeholder="Optional room ID" />
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

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="tf-doctor">Attending Doctor *</label>
        <select id="tf-doctor" value={form.assigned_doctor_id} onChange={set('assigned_doctor_id')} disabled={doctorsFetching} required>
          <option value="">— Select doctor —</option>
          {doctors.map((d) => (
            <option key={d.doctor_id} value={d.doctor_id}>
              Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
            </option>
          ))}
        </select>
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
