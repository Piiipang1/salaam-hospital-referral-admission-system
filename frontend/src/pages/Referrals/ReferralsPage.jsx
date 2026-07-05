import { useEffect, useState, useCallback } from 'react';
import { getAllReferrals, createReferral, updateReferralStatus } from '../../api/referrals.api';
import { useAuth } from '../../context/AuthContext';
import { canUpdateReferralStatus, canCreateReferral } from '../../utils/roleGuard';
import { formatDate } from '../../utils/formatDate';
import { REFERRAL_STATUSES } from '../../utils/constants';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import ReferralForm from '../../components/forms/ReferralForm';

const LIMIT = 20; // rows per page — must match backend default

const ReferralsPage = () => {
  const { user } = useAuth();

  const [data,      setData]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [filter,    setFilter]    = useState('');
  const [fromDate,  setFromDate]  = useState('');
  const [toDate,    setToDate]    = useState('');
  const [modal,     setModal]     = useState(null); // 'create' | { type:'status', referral }
  const [saving,    setSaving]    = useState(false);
  const [newStatus, setNewStatus] = useState('');

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

  // ── Action handlers ─────────────────────────────────────────────────────────
  const handleCreate = async (form) => {
    setSaving(true);
    try { await createReferral(form); setSuccess('Referral created.'); setModal(null); load(); }
    catch (err) { setError(err.response?.data?.message || 'Failed.'); }
    finally { setSaving(false); }
  };

  const handleUpdateStatus = async () => {
    if (!newStatus || !modal?.referral) return;
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

  // ── Table columns ───────────────────────────────────────────────────────────
  const columns = [
    { key: 'referral_id',    label: 'ID',       width: '60px', hideMobile: true },
    { key: 'patient_name',   label: 'Patient'   },
    { key: 'medical_condition', label: 'Condition', hideMobile: true, render: (r) => <span className="truncate" style={{ maxWidth:'200px', display:'block' }}>{r.medical_condition ?? '—'}</span> },
    { key: 'assigned_doctor_name', label: 'Assigned To', render: (r) => r.assigned_doctor_name
        ? <span style={{ display:'flex', flexDirection:'column' }}>
            <span>{r.assigned_doctor_name}</span>
            <span className="text-xs text-muted">{r.specialization || 'General'}</span>
          </span>
        : '—' },
    { key: 'referral_date',  label: 'Date',     hideMobile: true, render: (r) => formatDate(r.referral_date) },
    { key: 'status',         label: 'Status',   render: (r) => <Badge status={r.status} /> },
    {
      key: 'actions', label: '', width: '120px', align: 'right',
      render: (r) => canUpdateReferralStatus(user?.role) && r.status === 'Pending' && (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setNewStatus('Accepted'); setModal({ type:'status', referral:r }); }}>Update Status</Button>
      ),
    },
  ];

  // ── Pagination pill style (reuses existing filter pill aesthetic) ───────────
  const pillBase = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-2) var(--space-5)',
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
          <h2 className="page-title">Referrals</h2>
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

      {/* Update status modal */}
      <Modal isOpen={modal?.type === 'status'} onClose={() => setModal(null)} title="Update Referral Status" size="sm">
        <div className="form-group" style={{ marginBottom:'var(--space-6)' }}>
          <label htmlFor="ref-status-sel">New Status</label>
          <select id="ref-status-sel" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
            {REFERRAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleUpdateStatus} loading={saving}>Update</Button>
        </div>
      </Modal>

    </div>
  );
};

export default ReferralsPage;
