import { useState, useEffect } from 'react';
import { Stethoscope } from 'lucide-react';
import { getFollowupSuggestion } from '../../api/admissions.api';
import { getClinics } from '../../api/opd.api';
import Alert from '../ui/Alert';
import Spinner from '../ui/Spinner';

/**
 * OpdFollowupFields — the OPD booking captured when a discharge is confirmed.
 *
 * Every discharged inpatient leaves with an outpatient follow-up, so this is
 * not optional: the API refuses the discharge without a date, and books the
 * record in the same transaction.
 *
 * The clinic is routed automatically from the attending doctor's specialization
 * (then the admission type, then the default clinic). The suggestion is shown
 * with the reason it was chosen, and can be overridden — leaving it alone keeps
 * the booking classified as automatic.
 *
 * `onChange({ followup_date, clinic_id, followup_notes, valid })` reports state
 * up so the parent can gate its Confirm button.
 */
const OpdFollowupFields = ({ admissionId, onChange }) => {
  const [suggestion, setSuggestion] = useState(null);
  const [clinics,    setClinics]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  const [date,     setDate]     = useState('');
  const [clinicId, setClinicId] = useState('');   // '' = use the automatic route
  const [notes,    setNotes]    = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getFollowupSuggestion(admissionId), getClinics()])
      .then(([sug, cl]) => {
        if (cancelled) return;
        if (sug.success) { setSuggestion(sug.data); setDate(sug.data.default_date ?? ''); }
        if (cl.success)  setClinics(cl.data);
      })
      .catch(() => { if (!cancelled) setError('Could not load OPD routing. You can still pick a clinic and date.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [admissionId]);

  // Report upward whenever anything changes, including the initial default.
  useEffect(() => {
    onChange?.({
      followup_date: date,
      clinic_id: clinicId ? Number(clinicId) : undefined,
      followup_notes: notes.trim() || undefined,
      valid: !!date,
    });
  }, [date, clinicId, notes]); // onChange intentionally omitted — parents pass inline callbacks

  if (loading) return <Spinner />;

  const auto = suggestion?.suggested_clinic;
  const effectiveClinic = clinicId
    ? clinics.find((c) => String(c.clinic_id) === String(clinicId))
    : auto;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        fontWeight: 600, fontSize: 'var(--font-size-sm)',
      }}>
        <Stethoscope size={15} /> OPD Follow-up
      </div>

      {error && <Alert type="warning" message={error} />}

      {/* What the routing chose and why — shown before the nurse commits, not
          discovered afterwards from the success message. */}
      {auto && (
        <Alert
          type="info"
          message={
            clinicId
              ? `Routing suggested ${auto.name}; you have chosen ${effectiveClinic?.name ?? 'another clinic'} instead. This will be recorded as a manual assignment.`
              : `Automatically routed to ${auto.name}${suggestion?.routing_basis ? ` (${suggestion.routing_basis})` : ''}.`
          }
        />
      )}

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="opd-date">Follow-up Date *</label>
          <input
            id="opd-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          {!date && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>
              Required — a patient cannot be discharged without a follow-up booked.
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="opd-clinic">Clinic</label>
          <select id="opd-clinic" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
            <option value="">
              {auto ? `Automatic — ${auto.name}` : 'Automatic'}
            </option>
            {clinics.map((c) => (
              <option key={c.clinic_id} value={c.clinic_id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="opd-notes">Follow-up Instructions</label>
        <textarea
          id="opd-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What the OPD visit is for — wound review, repeat labs, medication check…"
        />
      </div>
    </div>
  );
};

export default OpdFollowupFields;
