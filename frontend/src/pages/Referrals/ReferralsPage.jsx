import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAllReferrals, createReferral, updateReferralStatus, reassignReferral } from '../../api/referrals.api';
import { getDoctorWorkload, getActiveDoctors } from '../../api/doctors.api';
import { useAuth } from '../../context/AuthContext';
import { canCreateReferral } from '../../utils/roleGuard';
import { formatDate } from '../../utils/formatDate';
import { REFERRAL_STATUSES } from '../../utils/constants';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import Card from '../../components/ui/Card';
import ReferralForm from '../../components/forms/ReferralForm';

const LIMIT = 20; // rows per page — must match backend default

// Purely presentational availability hint from combined load
const loadHint = (load) => {
  if (load <= 2) return { label: 'Available',  color: 'var(--color-primary)' };
  if (load <= 5) return { label: 'Busy',       color: 'var(--color-warning, #d97706)' };
  return          { label: 'Overloaded', color: 'var(--color-danger)' };
};

// Plain-language meaning of each referral status (legend + confirm modal).
const STATUS_MEANINGS = {
  Pending:   'Awaiting the assigned doctor’s response.',
  Accepted:  'The assigned doctor has taken responsibility for the patient.',
  Completed: 'The referred consultation is finished.',
  Cancelled: 'The referral has been withdrawn.',
};

const ReferralsPage = () => {
  const { user } = useAuth();

  // Pre-apply a status filter from the admin workflow stepper (?status=Pending)
  const [searchParams] = useSearchParams();
  const stepStatus = REFERRAL_STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : '';

  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [filter,    setFilter]    = useState(stepStatus);
  const [fromDate,  setFromDate]  = useState('');
  const [toDate,    setToDate]    = useState('');
  const [modal,     setModal]     = useState(null); // 'create' | { type:'status'|'reassign', referral }
  const [saving,    setSaving]    = useState(false);
  const [newStatus, setNewStatus] = useState('');

  // ── Doctor-in-Charge state ──────────────────────────────────────────────────
  // Seeded from the login response; a 403 from any DIC endpoint means the flag
  // was revoked mid-session — hide the DIC UI gracefully instead of crashing.
  const [dicActive, setDicActive] = useState(!!user?.is_doctor_in_charge && user?.role === 'doctor');
  const [workload,  setWorkload]  = useState([]);
  const [doctors,   setDoctors]   = useState([]);
  const [reassignDoctorId, setReassignDoctorId] = useState('');

  const handleDicRevoked = (msg) => {
    setDicActive(false);
    setModal(null);
    setSuccess('');
    setError(msg || 'Doctor-in-Charge mode is no longer active on your account.');
  };

  useEffect(() => {
    if (!dicActive) return;
    getDoctorWorkload()
      .then((r) => { if (r.success) setWorkload(r.data); })
      .catch((err) => {
        if (err.response?.status === 403) handleDicRevoked();
      });
    getActiveDoctors()
      .then((r) => { if (r.success) setDoctors(r.data); })
      .catch(() => {});
  }, [dicActive]);

  // ── Pagination state ────────────────────────────────────────────────────────
  const [page,  setPage]  = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [filter, fromDate, toDate]);

  // ── Data fetching ───────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    const params = { page, limit: LIMIT };
    if (filter)   params.status    = filter;
    if (fromDate) params.from_date = fromDate;
    if (toDate)   params.to_date   = toDate;

    getAllReferrals(params)
      .then((r) => {
        if (r.success) {
          setData(r.data);
          // Use total from API; fall back to data length if server is old
          setTotal(r.total ?? r.data.length);
        }
      })
      .catch(() => setError('Failed to load referrals.'))
      .finally(() => setLoading(false));
  }, [filter, fromDate, toDate, page]); // re-runs when any filter OR page changes

  useEffect(() => { load(); }, [load]);

  // Auto-dismiss success alerts so a stale one can't linger above a later message
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // ── Action handlers ─────────────────────────────────────────────────────────
  const handleCreate = async (form) => {
    setError(''); setSuccess('');
    setSaving(true);
    try { await createReferral(form); setSuccess('Referral created.'); setModal(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Failed.'); }
    finally { setSaving(false); }
  };

  const handleUpdateStatus = async () => {
    if (!newStatus || !modal?.referral) return;
    setError(''); setSuccess('');
    setSaving(true);
    try {
      await updateReferralStatus(modal.referral.referral_id, newStatus);
      setSuccess('Status updated.');
      setModal(null);
      load();
      // Notify other pages (Dashboard, Patients) to refresh their data (issue #12)
      window.dispatchEvent(new CustomEvent('referral-status-updated', { detail: { newStatus } }));
    }
    catch (err) { setError(err.response?.data?.message || 'Failed.'); }
    finally { setSaving(false); }
  };

  const handleReassign = async () => {
    if (!reassignDoctorId || !modal?.referral) return;
    setError(''); setSuccess('');
    setSaving(true);
    try {
      const res = await reassignReferral(modal.referral.referral_id, reassignDoctorId);
      setSuccess(res.message || 'Referral reassigned.');
      setModal(null);
      load();
      // Refresh workload counts after a reassignment
      getDoctorWorkload().then((r) => { if (r.success) setWorkload(r.data); }).catch(() => {});
    } catch (err) {
      if (err.response?.status === 403) handleDicRevoked(err.response?.data?.message);
      else setError(err.response?.data?.message || 'Reassign failed.');
    } finally { setSaving(false); }
  };

  // ── Table columns ───────────────────────────────────────────────────────────
  const columns = [
    { key: 'patient_name',   label: 'Patient'   },
    { key: 'medical_condition', label: 'Condition', hideMobile: true, render: (r) => <span className="truncate" style={{ maxWidth:'200px', display:'block' }}>{r.medical_condition ?? '—'}</span> },
    { key: 'referring_doctor_name', label: 'Referred By', hideMobile: true, render: (r) => {
        // "You" makes incoming vs outgoing referrals obvious at a glance
        if (user?.role === 'doctor' && r.referring_doctor_id === user?.linked_id) {
          return <span style={{ fontWeight: 600 }}>You</span>;
        }
        return r.referring_doctor_name ? `Dr. ${r.referring_doctor_name}` : '—';
      } },
    { key: 'assigned_doctor_name', label: 'Refer To', render: (r) => r.assigned_doctor_name
        ? <span style={{ display:'flex', flexDirection:'column' }}>
            <span>{r.assigned_doctor_name}</span>
            <span className="text-xs text-muted">{r.specialization || 'General'}</span>
          </span>
        : '—' },
    { key: 'referral_date',  label: 'Date',     hideMobile: true, render: (r) => formatDate(r.referral_date) },
    { key: 'status',         label: 'Status',   render: (r) => <Badge status={r.status} /> },
    {
      key: 'actions', label: '', width: '280px', align: 'right',
      render: (r) => {
        // Mirror the backend lifecycle: assigned doctor accepts/completes; the
        // referring doctor or an admin may cancel a non-terminal referral.
        const isAssigned  = user?.role === 'doctor' && r.assigned_doctor_id  === user?.linked_id;
        const isReferring = user?.role === 'doctor' && r.referring_doctor_id === user?.linked_id;
        const isAdmin     = user?.role === 'admin';
        const openStatus = (target) => (e) => { e.stopPropagation(); setNewStatus(target); setModal({ type:'status', referral:r }); };
        // minWidth keeps the auto-layout table from crushing the column below
        // two buttons per line; on narrow viewports the buttons wrap inside
        // the cell instead of overflowing it
        return (
          <div style={{ display:'flex', gap:'var(--space-2)', justifyContent:'flex-end', alignItems:'center', flexWrap:'wrap', minWidth:'180px' }}>
            {isAssigned && r.status === 'Pending' && (
              <Button size="sm" variant="primary" title="Take responsibility for this patient" onClick={openStatus('Accepted')}>Accept</Button>
            )}
            {isAssigned && r.status === 'Accepted' && (
              <Button size="sm" variant="primary" title="Mark the referred consultation as finished" onClick={openStatus('Completed')}>Complete</Button>
            )}
            {(isReferring || isAdmin) && ['Pending', 'Accepted'].includes(r.status) && (
              <Button size="sm" variant="danger" title="Withdraw this referral" onClick={openStatus('Cancelled')}>Cancel</Button>
            )}
            {dicActive && ['Pending', 'Accepted'].includes(r.status) && (
              <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setReassignDoctorId(''); setModal({ type:'reassign', referral:r }); }}>Reassign</Button>
            )}
          </div>
        );
      },
    },
  ];

  // ── Pagination pill style (reuses existing filter pill aesthetic) ───────────
  const pillBase = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    height: '38px', /* match .filter-date / .filter-clear-btn so the filter row shares one baseline */
    padding: '0 var(--space-5)',
    borderRadius: 'var(--radius-full)',
    border: '1px solid var(--color-border)',
    background: 'transparent',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 500,
    transition: 'all 0.15s',
    lineHeight: 1,
  };
  const pillDisabled = {
    ...pillBase,
    opacity: 0.35,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'var(--space-5)' }}>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Referrals</h1>
          <p className="page-subtitle">{total} referral{total !== 1 ? 's' : ''}</p>
        </div>
        {canCreateReferral(user?.role) && (
          <Button id="create-referral-btn" variant="primary" onClick={() => setModal('create')}>
            + Create Referral
          </Button>
        )}
      </div>

      {/* Alerts */}
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      {/* ── Doctor Workload — Doctor-in-Charge only ─────────────────────────── */}
      {dicActive && workload.length > 0 && (
        <Card title="Doctor Workload">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Doctor</th>
                  <th style={{ padding: 'var(--space-2)' }}>Specialty</th>
                  <th style={{ padding: 'var(--space-2)', textAlign: 'center' }}>Active Admissions</th>
                  <th style={{ padding: 'var(--space-2)', textAlign: 'center' }}>Pending Referrals</th>
                  <th style={{ padding: 'var(--space-2)', textAlign: 'center' }}>Patients in Charge</th>
                  <th style={{ padding: 'var(--space-2)' }}>Availability</th>
                </tr>
              </thead>
              <tbody>
                {workload.map((w) => {
                  const hint = loadHint(w.active_admissions + w.pending_referrals);
                  return (
                    <tr key={w.doctor_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: 'var(--space-2)', fontWeight: 600 }}>Dr. {w.name}</td>
                      <td style={{ padding: 'var(--space-2)', color: 'var(--color-text-muted)' }}>{w.specialization || 'General'}</td>
                      <td style={{ padding: 'var(--space-2)', textAlign: 'center' }}>{w.active_admissions}</td>
                      <td style={{ padding: 'var(--space-2)', textAlign: 'center' }}>{w.pending_referrals}</td>
                      <td style={{ padding: 'var(--space-2)', textAlign: 'center' }}>{w.patients_in_charge}</td>
                      <td style={{ padding: 'var(--space-2)', fontWeight: 600, color: hint.color }}>{hint.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Status filter pills */}
      <div style={{ display:'flex', gap:'var(--space-2)', flexWrap:'wrap', alignItems:'center' }}>
        {['', ...REFERRAL_STATUSES].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setFilter(s)}
            style={{
              ...pillBase,
              background: filter === s ? 'var(--color-primary)' : 'transparent',
              color:      filter === s ? '#fff' : 'var(--color-text-muted)',
              borderColor: filter === s ? 'var(--color-primary)' : 'var(--color-border)',
            }}
          >
            {s || 'All'}
          </button>
        ))}

        {/* Date range pickers */}
        <div className="filter-date-group">
          <span className="filter-date-label">From</span>
          <input
            id="referral-from-date"
            type="date"
            className="filter-date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="Referral from date"
          />
        </div>
        <div className="filter-date-group">
          <span className="filter-date-label">To</span>
          <input
            id="referral-to-date"
            type="date"
            className="filter-date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="Referral to date"
          />
        </div>

        {/* Clear all filters */}
        {(filter || fromDate || toDate) && (
          <button
            className="filter-clear-btn"
            onClick={() => { setFilter(''); setFromDate(''); setToDate(''); }}
            title="Clear all filters"
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Status lifecycle legend — what each status means */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'var(--space-4)', alignItems:'center' }}>
        {REFERRAL_STATUSES.map((s) => (
          <span key={s} style={{ display:'inline-flex', alignItems:'center', gap:'var(--space-2)', fontSize:'var(--font-size-xs)', color:'var(--color-text-muted)' }}>
            <Badge status={s} />
            {STATUS_MEANINGS[s]}
          </span>
        ))}
      </div>

      {/* Table */}
      <Table columns={columns} data={data} loading={loading} emptyMessage="No referrals found." />

      {/* ── Pagination controls ─────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'var(--space-4)', paddingTop:'var(--space-2)' }}>

          {/* Previous */}
          <button
            style={page <= 1 ? pillDisabled : pillBase}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </button>

          {/* Page indicator */}
          <span style={{ fontSize:'var(--font-size-sm)', color:'var(--color-text-muted)', minWidth:'100px', textAlign:'center' }}>
            Page <strong style={{ color:'var(--color-text)' }}>{page}</strong> of <strong style={{ color:'var(--color-text)' }}>{totalPages}</strong>
          </span>

          {/* Next */}
          <button
            style={page >= totalPages ? pillDisabled : pillBase}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>

        </div>
      )}

      {/* Create referral modal */}
      <Modal isOpen={modal === 'create'} onClose={() => setModal(null)} title="Create Referral" size="md">
        <ReferralForm onSubmit={handleCreate} loading={saving} />
      </Modal>

      {/* Status transition confirm modal — target is fixed by the action button */}
      <Modal
        isOpen={modal?.type === 'status'}
        onClose={() => setModal(null)}
        title={newStatus === 'Cancelled' ? 'Cancel Referral' : `Mark Referral as ${newStatus}`}
        size="sm"
      >
        <p className="text-sm" style={{ marginBottom:'var(--space-2)' }}>
          Set the referral for <strong>{modal?.referral?.patient_name}</strong> to <strong>{newStatus}</strong>?
        </p>
        <p className="text-sm text-muted" style={{ marginBottom:'var(--space-6)' }}>
          {STATUS_MEANINGS[newStatus]}
        </p>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
          <Button variant={newStatus === 'Cancelled' ? 'danger' : 'primary'} onClick={handleUpdateStatus} loading={saving}>
            Confirm
          </Button>
        </div>
      </Modal>

      {/* Reassign modal — Doctor-in-Charge only */}
      <Modal isOpen={modal?.type === 'reassign'} onClose={() => setModal(null)} title="Reassign Referral" size="sm">
        <p className="text-sm text-muted" style={{ marginBottom:'var(--space-4)' }}>
          Reassign the referral for <strong>{modal?.referral?.patient_name}</strong> to another doctor.
          Both the new assignee and the referring doctor will be notified.
        </p>
        <div className="form-group" style={{ marginBottom:'var(--space-6)' }}>
          <label htmlFor="ref-reassign-sel">Refer To *</label>
          <select id="ref-reassign-sel" value={reassignDoctorId} onChange={(e) => setReassignDoctorId(e.target.value)} required>
            <option value="">— Select doctor —</option>
            {doctors.map((d) => (
              <option key={d.doctor_id} value={d.doctor_id}>
                Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleReassign} loading={saving} disabled={!reassignDoctorId}>Reassign</Button>
        </div>
      </Modal>

    </div>
  );
};

export default ReferralsPage;
