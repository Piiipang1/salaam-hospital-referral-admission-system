import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { getActivityLogs, getActivityLogsMeta } from '../../api/audit.api';
import Table  from '../../components/ui/Table';
import Alert  from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import { formatDate } from '../../utils/formatDate';
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
    {role ?? '—'}
  </span>
);

// ── Affected record — merged "Table #id" label, e.g. "Patients #12" ──────────
const affectedRecord = (r) => {
  if (!r.target_table) return '—';
  const table = r.target_table.charAt(0).toUpperCase() + r.target_table.slice(1);
  return r.target_id != null ? `${table} #${r.target_id}` : table;
};

// ── CSV export ────────────────────────────────────────────────────────────────
const exportCSV = (rows) => {
  const headers = ['Log ID', 'Date/Time', 'User', 'Role', 'Action', 'Affected Record'];
  const lines   = rows.map((r) => [
    r.log_id,
    formatDate(r.created_at, true),
    r.username ?? '',
    r.role     ?? '',
    r.action,
    affectedRecord(r),
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

// ── Main component ────────────────────────────────────────────────────────────
const AuditPage = () => {
  // ── Filter state ──────────────────────────────────────────────
  const [userId,      setUserId]      = useState('');
  const [action,      setAction]      = useState('');
  const [targetTable, setTargetTable] = useState('');
  const [fromDate,    setFromDate]    = useState('');
  const [toDate,      setToDate]      = useState('');

  // ── Data state ────────────────────────────────────────────────
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // ── Meta (dropdown options) ───────────────────────────────────
  const [users,         setUsers]         = useState([]);
  const [actionOptions, setActionOptions] = useState([]);
  const [tableOptions,  setTableOptions]  = useState([]);

  const totalPages        = Math.max(1, Math.ceil(total / LIMIT));
  const hasActiveFilters  = userId || action || targetTable || fromDate || toDate;

  // Load filter dropdown options once
  useEffect(() => {
    getActivityLogsMeta()
      .then((r) => {
        if (r.success) {
          setUsers(r.data.users);
          setActionOptions(r.data.actions);
          setTableOptions(r.data.target_tables);
        }
      })
      .catch(() => {}); // non-critical; filters still work without it
  }, []);

  // Reset page when any filter changes
  useEffect(() => { setPage(1); }, [userId, action, targetTable, fromDate, toDate]);

  // Fetch data
  const load = useCallback(() => {
    setLoading(true);
    const params = { page, limit: LIMIT };
    if (userId)      params.user_id      = userId;
    if (action)      params.action       = action;
    if (targetTable) params.target_table = targetTable;
    if (fromDate)    params.from_date    = fromDate;
    if (toDate)      params.to_date      = toDate;

    getActivityLogs(params)
      .then((r) => {
        if (r.success) { setRows(r.data); setTotal(r.total); }
      })
      .catch(() => setError('Failed to load audit logs.'))
      .finally(() => setLoading(false));
  }, [page, userId, action, targetTable, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  // ── Table columns ──────────────────────────────────────────────
  const columns = [
    {
      key: 'created_at', label: 'Date / Time', width: '160px',
      render: (r) => (
        <span className="audit-datetime">{formatDate(r.created_at, true)}</span>
      ),
    },
    {
      key: 'username', label: 'User',
      render: (r) => (
        <span className="audit-user">{r.username ?? <em className="text-muted">deleted</em>}</span>
      ),
    },
    {
      key: 'role', label: 'Role', width: '90px',
      render: (r) => <RolePill role={r.role} />,
    },
    {
      key: 'action', label: 'Action', width: '130px',
      render: (r) => <ActionPill action={r.action} />,
    },
    {
      key: 'affected_record', label: 'Affected Record', width: '160px', hideMobile: true,
      render: (r) => (
        <code className="audit-table-name">{affectedRecord(r)}</code>
      ),
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
          onClick={() => exportCSV(rows)}
          disabled={rows.length === 0}
        >
          <Download size={14} /> Export CSV
        </Button>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      {/* ── Filter toolbar ── */}
      <div className="audit-toolbar">

        {/* User dropdown */}
        <select
          id="audit-filter-user"
          className="filter-select"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          aria-label="Filter by user"
        >
          <option value="">All Users</option>
          {users.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.username} ({u.role})
            </option>
          ))}
        </select>

        {/* Action dropdown */}
        <select
          id="audit-filter-action"
          className="filter-select"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
        >
          <option value="">All Actions</option>
          {actionOptions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        {/* Target table dropdown */}
        <select
          id="audit-filter-table"
          className="filter-select"
          value={targetTable}
          onChange={(e) => setTargetTable(e.target.value)}
          aria-label="Filter by target table"
        >
          <option value="">All Tables</option>
          {tableOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
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
              setUserId(''); setAction(''); setTargetTable('');
              setFromDate(''); setToDate('');
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
