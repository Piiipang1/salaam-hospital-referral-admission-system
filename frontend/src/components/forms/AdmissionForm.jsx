import { useState, useEffect } from 'react';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Spinner from '../ui/Spinner';
import { ADMISSION_TYPES } from '../../utils/constants';
import { getActiveDoctors } from '../../api/doctors.api';
import { getAllRooms } from '../../api/rooms.api';

const AdmissionForm = ({ patientId, diagnosisId, initial = {}, onSubmit, loading }) => {
  const [form, setForm] = useState({
    patient_id:     initial.patient_id   ?? patientId   ?? '',
    diagnosis_id:   initial.diagnosis_id ?? diagnosisId ?? '',
    doctor_id:      initial.doctor_id    ?? '',
    room_id:        initial.room_id      ?? '',
    admission_type: initial.admission_type ?? '',
  });
  const [error,   setError]   = useState('');
  const [doctors, setDoctors] = useState([]);
  const [rooms,   setRooms]   = useState([]);
  const [fetching, setFetching] = useState(true);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Load doctors and available rooms when form mounts
  useEffect(() => {
    Promise.all([getActiveDoctors(), getAllRooms()])
      .then(([docRes, roomRes]) => {
        if (docRes.success)  setDoctors(docRes.data);
        if (roomRes.success) setRooms(roomRes.data.filter(r => r.availability_status === 'available'));
      })
      .catch(() => setError('Failed to load doctors or rooms.'))
      .finally(() => setFetching(false));
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.patient_id || !form.doctor_id || !form.room_id || !form.admission_type) {
      setError('Patient ID, doctor, room, and admission type are required.');
      return;
    }
    setError('');
    onSubmit(form);
  };

  if (fetching) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && <Alert type="error" message={error} style={{ marginBottom: 'var(--space-4)' }} />}

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="af-pat">Patient ID *</label>
          <input
            id="af-pat"
            type="number"
            value={form.patient_id}
            onChange={set('patient_id')}
            placeholder="Patient ID"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="af-diag">Diagnosis ID</label>
          <input
            id="af-diag"
            type="number"
            value={form.diagnosis_id}
            onChange={set('diagnosis_id')}
            placeholder="Linked diagnosis (optional)"
          />
        </div>
      </div>

      {/* Doctor dropdown — populated from /api/doctors/active */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="af-doc">Admitting Doctor *</label>
        <select id="af-doc" value={form.doctor_id} onChange={set('doctor_id')} required>
          <option value="">— Select doctor —</option>
          {doctors.map((d) => (
            <option key={d.doctor_id} value={d.doctor_id}>
              Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
            </option>
          ))}
        </select>
        {doctors.length === 0 && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            No active doctors found.
          </span>
        )}
      </div>

      {/* Available room dropdown — populated from /api/rooms filtered to available */}
      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="af-room">Available Room *</label>
        <select id="af-room" value={form.room_id} onChange={set('room_id')} required>
          <option value="">— Select room —</option>
          {rooms.map((r) => (
            <option key={r.room_id} value={r.room_id}>
              {r.room_type} — Bed {r.bed_number}
            </option>
          ))}
        </select>
        {rooms.length === 0 && (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-warning)' }}>
            No available rooms. Discharge a patient first.
          </span>
        )}
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="af-type">Admission Type *</label>
        <select id="af-type" value={form.admission_type} onChange={set('admission_type')} required>
          <option value="">— Select type —</option>
          {ADMISSION_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading} disabled={rooms.length === 0}>
          Admit Patient
        </Button>
      </div>
    </form>
  );
};

export default AdmissionForm;
