import { useState, useEffect, useCallback } from 'react';
import { Check, Lock } from 'lucide-react';
import {
  getDischargeClearance, verifyClearanceItem, unverifyClearanceItem,
} from '../../api/admissions.api';
import { CLEARANCE_HINTS } from '../../utils/constants';
import { formatDate } from '../../utils/formatDate';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Spinner from '../ui/Spinner';

/**
 * DischargeClearanceChecklist — the three clearances a patient must have before
 * they can be discharged.
 *
 * Billing and Administrative are ticked here by the nurse who
 * did the work. The doctor's discharge order is NOT tickable: it is recorded
 * when the doctor initiates the discharge, so this renders read-only. Asking a
 * nurse to assert that a doctor ordered something is exactly what the checklist
 * exists to prevent.
 *
 * `onChange(state)` fires after every successful change so the parent can
 * enable or disable its Confirm Discharge button.
 */
const DischargeClearanceChecklist = ({ admissionId, role, readOnly = false, onChange }) => {
  const [state,   setState]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [busy,    setBusy]    = useState(null); // item currently being toggled
  const [notes,   setNotes]   = useState({});   // item -> pending note text

  const load = useCallback(() => {
    setLoading(true);
    getDischargeClearance(admissionId)
      .then((res) => {
        if (res.success) { setState(res.data); onChange?.(res.data); }
      })
      .catch((err) => setError(err.response?.data?.message || 'Failed to load the clearance checklist.'))
      .finally(() => setLoading(false));
  }, [admissionId]); // onChange intentionally omitted — parents pass inline callbacks

  useEffect(() => { load(); }, [load]);

  const toggle = async (row) => {
    setError('');
    setBusy(row.item);
    try {
      const res = row.verified
        ? await unverifyClearanceItem(admissionId, row.item)
        : await verifyClearanceItem(admissionId, row.item, notes[row.item]);
      if (res.data) { setState(res.data); onChange?.(res.data); }
      setNotes((n) => ({ ...n, [row.item]: '' }));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update that item.');
    } finally { setBusy(null); }
  };

  if (loading) return <Spinner />;
  if (!state)  return <Alert type="error" message={error || 'Clearance unavailable.'} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {state.items.map((row) => {
          // The API is the authority on who may touch what — mirror its answer
          // rather than re-deriving the rule here.
          const canEdit = !readOnly && row.verifiable_by.includes(role);
          return (
            <div
              key={row.item}
              style={{
                border: '1px solid var(--color-border)',
                borderLeft: `3px solid ${row.verified ? 'var(--color-success)' : 'var(--color-warning)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-3)',
                background: row.verified ? 'var(--color-surface)' : 'var(--color-surface-2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: row.verified ? 'var(--color-success)' : 'transparent',
                    border: row.verified ? 'none' : '1px solid var(--color-border)',
                    color: '#fff',
                  }}
                >
                  {row.verified ? <Check size={14} /> : null}
                </span>

                <span style={{ flex: 1, minWidth: '180px' }}>
                  <span style={{ fontWeight: 600 }}>{row.label}</span>
                  <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    {row.verified
                      ? `Cleared by ${row.verified_by_name ?? 'a deleted account'} · ${formatDate(row.verified_at, true)}`
                      : CLEARANCE_HINTS[row.item]}
                  </span>
                  {row.verified && row.notes && (
                    <span style={{ display: 'block', fontSize: 'var(--font-size-xs)', marginTop: '2px' }}>
                      {row.notes}
                    </span>
                  )}
                </span>

                {canEdit ? (
                  <Button
                    size="sm"
                    variant={row.verified ? 'outline' : 'primary'}
                    loading={busy === row.item}
                    onClick={() => toggle(row)}
                  >
                    {row.verified ? 'Undo' : 'Mark Cleared'}
                  </Button>
                ) : (
                  <span
                    title={row.verifiable_by.includes('doctor')
                      ? 'Recorded by the doctor who ordered the discharge'
                      : `Cleared by: ${row.verifiable_by.join(' or ')}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)',
                    }}
                  >
                    <Lock size={12} /> {row.verified ? 'Recorded' : 'Awaiting doctor'}
                  </span>
                )}
              </div>

              {/* Optional reference, captured at the moment of clearing */}
              {canEdit && !row.verified && (
                <input
                  value={notes[row.item] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [row.item]: e.target.value }))}
                  placeholder="Optional reference (e.g. receipt number)"
                  maxLength={255}
                  style={{ marginTop: 'var(--space-2)', width: '100%' }}
                />
              )}
            </div>
          );
        })}
      </div>

      <Alert
        type={state.complete ? 'success' : 'warning'}
        message={state.complete
          ? `All ${state.total_count} clearances complete — this patient can be discharged.`
          : `${state.cleared_count} of ${state.total_count} clearances complete. Discharge stays blocked until all three are verified.`}
      />
    </div>
  );
};

export default DischargeClearanceChecklist;
