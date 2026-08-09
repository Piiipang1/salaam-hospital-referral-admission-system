import { useState, useEffect } from 'react';
import { getWardPatients, getWardNurses } from '../../api/nursing.api';
import { todayInput } from '../../utils/formatDate';
import { SHIFTS } from '../../utils/constants';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';

/**
 * EndorsementForm — hand this shift's patients to the next nurse on duty.
 *
 * Only patients currently assigned to ME can be endorsed; you cannot hand over
 * what you are not holding, and the API enforces the same rule. Every patient
 * starts ticked, since the default handoff is "all of them" — untick the ones
 * staying behind.
 */
const EndorsementForm = ({ onSubmit, loading }) => {
  const [nurses,   setNurses]   = useState([]);
  const [patients, setPatients] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error,    setError]    = useState('');

  const [toNurseId,    setToNurseId]    = useState('');
  const [shift,        setShift]        = useState(SHIFTS[0]);
  const [shiftDate,    setShiftDate]    = useState(todayInput());
  const [generalNotes, setGeneralNotes] = useState('');

  // patient_id -> { selected, notes }
  const [rows, setRows] = useState({});

  useEffect(() => {
    Promise.all([getWardNurses(), getWardPatients(true)])
      .then(([nurseRes, patientRes]) => {
        if (nurseRes.success)   setNurses(nurseRes.data);
        if (patientRes.success) {
          setPatients(patientRes.data);
          setRows(Object.fromEntries(
            patientRes.data.map((p) => [p.patient_id, { selected: true, notes: '' }])
          ));
        }
      })
      .catch(() => setError('Failed to load your ward.'))
      .finally(() => setFetching(false));
  }, []);

  const toggle = (id) => setRows((r) => ({ ...r, [id]: { ...r[id], selected: !r[id]?.selected } }));
  const setNote = (id, notes) => setRows((r) => ({ ...r, [id]: { ...r[id], notes } }));

  const selectedIds = patients
    .map((p) => p.patient_id)
    .filter((id) => rows[id]?.selected);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!toNurseId) { setError('Select the nurse taking over.'); return; }
    setError('');
    onSubmit({
      to_nurse_id: Number(toNurseId),
      shift,
      shift_date: shiftDate,
      general_notes: generalNotes.trim() || undefined,
      patients: selectedIds.map((id) => ({
        patient_id: id,
        notes: rows[id]?.notes?.trim() || undefined,
      })),
    });
  };

  if (fetching) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Alert takes no style prop — the wrapper carries the spacing */}
      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert type="error" message={error} />
        </div>
      )}

      {nurses.length === 0 && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert
            type="warning"
            message="No other active nurse is assigned to your ward, so there is nobody to hand off to. An administrator can assign one under User Management."
          />
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="end-shift">Shift Ending *</label>
          <select id="end-shift" value={shift} onChange={(e) => setShift(e.target.value)} required>
            {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="end-date">Shift Date *</label>
          <input id="end-date" type="date" value={shiftDate}
            onChange={(e) => setShiftDate(e.target.value)} required />
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="end-nurse">Hand Off To *</label>
        <select
          id="end-nurse"
          value={toNurseId}
          onChange={(e) => setToNurseId(e.target.value)}
          disabled={nurses.length === 0}
          required
        >
          <option value="">— Select the incoming nurse —</option>
          {nurses.map((n) => (
            <option key={n.employee_id} value={n.employee_id}>
              {n.first_name} {n.last_name} ({n.current_patients} patient{n.current_patients !== 1 ? 's' : ''})
            </option>
          ))}
        </select>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
          Active nurses in your ward. They take over only once they acknowledge this endorsement.
        </span>
      </div>

      {/* ── Patients being handed over ─────────────────────────────────── */}
      <div className="form-group" style={{ marginTop: 'var(--space-5)' }}>
        <label>
          Patients to Endorse ({selectedIds.length} of {patients.length})
        </label>

        {patients.length === 0 ? (
          <Alert
            type="info"
            message="No patients are assigned to you right now. You can still endorse the shift with ward-wide notes only."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {patients.map((p) => {
              const row = rows[p.patient_id] ?? {};
              return (
                <div
                  key={p.patient_id}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-3)',
                    background: row.selected ? 'var(--color-surface)' : 'var(--color-surface-2)',
                    opacity: row.selected ? 1 : 0.6,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!row.selected}
                      onChange={() => toggle(p.patient_id)}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    <span style={{ fontWeight: 600 }}>{p.bed_number}</span>
                    <span>{p.patient_name}</span>
                    {p.triage_level && <Badge status={p.triage_level} />}
                    <Badge status={p.admission_status} />
                  </label>

                  {row.selected && (
                    <textarea
                      rows={2}
                      value={row.notes ?? ''}
                      onChange={(e) => setNote(p.patient_id, e.target.value)}
                      placeholder={`What the incoming nurse needs to know about ${p.patient_name.split(' ')[0]} — meds due, obs frequency, pending results…`}
                      style={{ marginTop: 'var(--space-2)', width: '100%' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
        <label htmlFor="end-general">Ward Notes</label>
        <textarea
          id="end-general"
          rows={3}
          value={generalNotes}
          onChange={(e) => setGeneralNotes(e.target.value)}
          placeholder="Anything not tied to one patient — supplies, equipment, expected admissions…"
        />
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={loading} disabled={nurses.length === 0}>
          Endorse Shift
        </Button>
      </div>
    </form>
  );
};

export default EndorsementForm;
