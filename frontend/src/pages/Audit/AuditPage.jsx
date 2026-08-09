import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { getActivityLogs } from '../../api/audit.api';
import Table  from '../../components/ui/Table';
import Alert  from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import { formatDate } from '../../utils/formatDate';
import { ROLE_LABELS } from '../../utils/constants';
import './AuditPage.css';

const LIMIT = 25;

// ── Action colour pills ───────────────────────────────────────────────────────
const ACTION_COLORS = {
  LOGIN:         { bg: 'var(--color-info-muted)',    color: 'var(--color-info)'    },
  LOGOUT:        { bg: 'var(--color-surface-2)',     color: 'var(--color-text-muted)' },
  CREATE:        { bg: 'var(--color-success-muted)', color: 'var(--color-success)' },
  UPDATE:        { bg: 'var(--color-primary-muted)', color: 'var(--color-primary)' },
  UPDATE_STATUS: { bg: 'var(--color-warning-muted)', color: 'var(--color-warning)' },
  DEACTIVATE:    { bg: 'var(--color-danger-muted)',  color: 'var(--color-danger)'  },
  DISCHARGE:     { bg: 'var(--color-warning-muted)', color: 'var(--color-warning)' },
};

const ActionPill = ({ action }) => {
  const style = ACTION_COLORS[action] ?? {
    bg: 'var(--color-surface-2)', color: 'var(--color-text-muted)',
  };
  return (
    <span className="audit-action-pill" style={{ background: style.bg, color: style.color }}>
      {action}
    </span>
  );
};

const RolePill = ({ role }) => (
  <span className={`audit-role-pill audit-role-pill--${role ?? 'unknown'}`}>
    {role ? (ROLE_LABELS[role] ?? role) : '—'}
  </span>
);

// ── CSV export ────────────────────────────────────────────────────────────────
const exportCSV = (rows) => {
  const headers = ['Log ID', 'Date/Time', 'Role', 'Action'];
  const lines   = rows.map((r) => [
    r.log_id,
    formatDate(r.created_at, true),
    r.role     ?? '',
    r.action,
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv  = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── Roles available for filtering ─────────────────────────────────────────────
// Only clinical + admin roles that can appear in the audit log
const FILTER_ROLES = [
  { value: 'doctor', label: 'Doctor'  },
  { value: 'nurse',  label: 'Nurse'   },
  { value: 'admin',  label: 'Admin'   },
];

// ── Main component ────────────────────────────────────────────────────────────
const AuditPage = () => {
  // ── Filter state ──────────────────────────────────────────────
  const [roleFilter, setRoleFilter] = useState('');
  const [fromDate,   setFromDate]   = useState('');
  const [toDate,     setToDate]     = useState('');

  // ── Data state ────────────────────────────────────────────────
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [exporting, setExporting] = useState(false);

  const totalPages       = Math.max(1, Math.ceil(total / LIMIT));
  const hasActiveFilters = roleFilter || fromDate || toDate;

  // Reset page when any filter changes
  useEffect(() => { setPage(1); }, [roleFilter, fromDate, toDate]);

  // Fetch data
  const load = useCallback(() => {
    setLoading(true);
    const params = { page, limit: LIMIT };
    if (roleFilter) params.role      = roleFilter;
    if (fromDate)   params.from_date = fromDate;
    if (toDate)     params.to_date   = toDate;

    getActivityLogs(params)
      .then((r) => {
        if (r.success) { setRows(r.data); setTotal(r.total); }
      })
      .catch(() => setError('Failed to load audit logs.'))
      .finally(() => setLoading(false));
  }, [page, roleFilter, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  // Export ALL rows matching the current filters (not just the visible page)
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = { page: 1, limit: total || 100000 };
      if (roleFilter) params.role      = roleFilter;
      if (fromDate)   params.from_date = fromDate;
      if (toDate)     params.to_date   = toDate;
      const res = await getActivityLogs(params);
      if (res.success) exportCSV(res.data);
    } catch {
      /* keep the page's existing error display pattern */
    } finally {
      setExporting(false);
    }
  };

  // ── Table columns ──────────────────────────────────────────────
  const columns = [
    {
      key: 'created_at', label: 'Date / Time', width: '160px',
      render: (r) => (
        <span className="audit-datetime">{formatDate(r.created_at, true)}</span>
      ),
    },
    {
      key: 'role', label: 'Role', width: '110px',
      render: (r) => <RolePill role={r.role} />,
    },
    {
      key: 'action', label: 'Action', width: '130px',
      render: (r) => <ActionPill action={r.action} />,
    },
  ];

  return (
    <div className="audit-page">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Trail</h1>
          <p className="page-subtitle">
            {total.toLocaleString()} log entr{total !== 1 ? 'ies' : 'y'}
            {hasActiveFilters ? ' (filtered)' : ''}
          </p>
        </div>
        <Button
          id="audit-export-btn"
          variant="outline"
          size="sm"
          onClick={handleExport}
          loading={exporting}
          disabled={rows.length === 0}
        >
          <Download size={14} /> Export CSV
        </Button>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      {/* ── Filter toolbar ── */}
      <div className="audit-toolbar">

        {/* Role dropdown — shows general positions only, not individual usernames */}
        <select
          id="audit-filter-role"
          className="filter-select"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
        >
          <option value="">All Users</option>
          {FILTER_ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        {/* Date range */}
        <div className="filter-date-group">
          <span className="filter-date-label">From</span>
          <input
            id="audit-from-date"
            type="date"
            className="filter-date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
        </div>
        <div className="filter-date-group">
          <span className="filter-date-label">To</span>
          <input
            id="audit-to-date"
            type="date"
            className="filter-date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </div>

        {/* Clear */}
        {hasActiveFilters && (
          <button
            className="filter-clear-btn"
            onClick={() => {
              setRoleFilter(''); setFromDate(''); setToDate('');
            }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── Data table ── */}
      <Table
        columns={columns}
        data={rows}
        loading={loading}
        emptyMessage="No activity logs match the current filters."
      />

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="audit-pagination">
          <span className="audit-pagination__info">
            Page {page} of {totalPages} · {total.toLocaleString()} entries
          </span>
          <div className="audit-pagination__controls">
            <button
              className="audit-page-btn"
              onClick={() => setPage(1)}
              disabled={page === 1}
              title="First page"
            >«</button>
            <button
              className="audit-page-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >‹ Prev</button>
            <span className="audit-page-current">{page}</span>
            <button
              className="audit-page-btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >Next ›</button>
            <button
              className="audit-page-btn"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              title="Last page"
            >»</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditPage;
