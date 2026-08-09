import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Database, Download, RotateCcw, Trash2 } from 'lucide-react';
import { getAllUsers, createUser, updateUser, deactivateUser, reactivateUser, setDoctorInCharge } from '../../api/users.api';
import { createBackup, listBackups, getBackupDownloadUrl, restoreBackup, deleteBackup } from '../../api/backup.api';
import { getAllDepartments, setEmployeeDepartment } from '../../api/departments.api';
import { formatDate } from '../../utils/formatDate';
import { ROLE_LABELS } from '../../utils/constants';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import UserForm from '../../components/forms/UserForm';
import Card from '../../components/ui/Card';
// Reuse the audit page's pager styles so the pagination looks identical.
import '../Audit/AuditPage.css';

// ─── Helper ───────────────────────────────────────────────────────────────────
const relativeDate = (iso) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)   return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
};

// ─── Reusable per-role table section ───────────────────────────────────────────
// Each section owns its OWN search / status / (DIC) / sort / page state — the
// three tables are fully independent. All filtering, sorting, and pagination is
// client-side (the parent already holds every account in `users`).
const PAGE_SIZE = 10;

const SORT_OPTIONS = [
  { value: 'created_desc', label: 'Newest first'  },
  { value: 'created_asc',  label: 'Oldest first'  },
  { value: 'username_az',  label: 'Username A–Z'  },
  { value: 'username_za',  label: 'Username Z–A'  },
  { value: 'name_az',      label: 'Full name A–Z' },
  { value: 'name_za',      label: 'Full name Z–A' },
];

const UserTableSection = ({ title, rows, loading, columns, emptyMessage, badgeStyle, showDicFilter = false }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');           // all | active | inactive
  const [dic,    setDic]    = useState('all');            // all | dic | nondic (doctors only)
  const [sort,   setSort]   = useState('created_desc');
  const [page,   setPage]   = useState(1);

  // ── Filter (search matches username OR full name; guard null linked_name) ──
  const q = search.trim().toLowerCase();
  const filtered = rows.filter((u) => {
    if (q) {
      const uname = (u.username ?? '').toLowerCase();
      const name  = (u.linked_name ?? '').toLowerCase();
      if (!uname.includes(q) && !name.includes(q)) return false;
    }
    if (status === 'active'   && !u.is_active) return false;
    if (status === 'inactive' &&  u.is_active) return false;
    if (showDicFilter) {
      if (dic === 'dic'    && !u.is_doctor_in_charge) return false;
      if (dic === 'nondic' &&  u.is_doctor_in_charge) return false;
    }
    return true;
  });

  // ── Sort (copy first so the incoming array is never mutated; null name → '') ──
  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'created_asc': return new Date(a.created_at) - new Date(b.created_at);
      case 'username_az': return (a.username ?? '').localeCompare(b.username ?? '');
      case 'username_za': return (b.username ?? '').localeCompare(a.username ?? '');
      case 'name_az':     return (a.linked_name ?? '').localeCompare(b.linked_name ?? '');
      case 'name_za':     return (b.linked_name ?? '').localeCompare(a.linked_name ?? '');
      case 'created_desc':
      default:            return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  // Reset to page 1 when any filter/sort changes so we never strand on an empty page.
  useEffect(() => { setPage(1); }, [search, status, dic, sort]);
  // Clamp if the row set shrank underneath us (e.g. after a reload/deactivate).
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'var(--space-3)'}}>
      {/* Heading + count pill (count reflects rows AFTER filtering) */}
      <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)'}}>
        <h2 style={{margin:0,fontSize:'var(--font-size-lg)',fontWeight:700}}>{title}</h2>
        <span style={badgeStyle}>{loading ? '…' : filtered.length}</span>
      </div>

      {/* Controls — stack cleanly on mobile */}
      <div style={{display:'flex',gap:'var(--space-3)',flexWrap:'wrap'}}>
        <input
          className="filter-select"
          style={{cursor:'text',minWidth:'220px'}}
          type="text"
          placeholder="Search username or name…"
          value={search}
          onChange={(e)=>setSearch(e.target.value)}
          aria-label={`Search ${title}`}
        />
        <select className="filter-select" value={status} onChange={(e)=>setStatus(e.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {showDicFilter && (
          <select className="filter-select" value={dic} onChange={(e)=>setDic(e.target.value)} aria-label="Filter by Doctor-in-Charge">
            <option value="all">All doctors</option>
            <option value="dic">DIC only</option>
            <option value="nondic">Non-DIC</option>
          </select>
        )}
        <select className="filter-select" value={sort} onChange={(e)=>setSort(e.target.value)} aria-label="Sort order">
          {SORT_OPTIONS.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <Table columns={columns} data={pageRows} loading={loading} emptyMessage={emptyMessage} />

      {/* Pager — hidden when a single page (mirrors AuditPage markup/styling) */}
      {totalPages > 1 && (
        <div className="audit-pagination">
          <span className="audit-pagination__info">
            Page {page} of {totalPages} · {sorted.length} account{sorted.length!==1?'s':''}
          </span>
          <div className="audit-pagination__controls">
            <button
              className="audit-page-btn"
              onClick={()=>setPage((p)=>Math.max(1,p-1))}
              disabled={page===1}
            >‹ Previous</button>
            <span className="audit-page-current">{page}</span>
            <button
              className="audit-page-btn"
              onClick={()=>setPage((p)=>Math.min(totalPages,p+1))}
              disabled={page===totalPages}
            >Next ›</button>
          </div>
        </div>
      )}
    </div>
  );
};

const UserManagementPage = () => {
  const BACKUPS_ENABLED = import.meta.env.VITE_ENABLE_BACKUPS === 'true';

  // Role filter from the sidebar submenu (?role=doctor|nurse). null = show all.
  const [searchParams] = useSearchParams();
  const roleFilter = searchParams.get('role');

  // ── User management state ──────────────────────────────────────────────────
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(null); // null | 'new' | user object
  const [confirm,          setConfirm]          = useState(null); // user row to deactivate
  const [reactivateConfirm, setReactivateConfirm] = useState(null); // user row to reactivate
  const [saving,  setSaving]  = useState(false);

  // ── Doctor-in-Charge toggle state ──────────────────────────────────────────
  // dicTarget = { row, enabled }; dicStep: 'confirm' (enable only) → 'password'
  const [dicTarget,   setDicTarget]   = useState(null);
  const [dicStep,     setDicStep]     = useState(null);
  const [dicPassword, setDicPassword] = useState('');
  const [dicSaving,   setDicSaving]   = useState(false);

  // ── Nurse ward assignment ──────────────────────────────────────────────────
  // A nurse with no department cannot use the ward roster or endorsements at
  // all, so this is the screen that switches those features on for them.
  const [departments, setDepartments] = useState([]);
  const [deptTarget,  setDeptTarget]  = useState(null); // nurse row being edited
  const [deptChoice,  setDeptChoice]  = useState('');
  const [deptSaving,  setDeptSaving]  = useState(false);

  // ── Backup state ───────────────────────────────────────────────────────────
  const [backups,        setBackups]        = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [backupRunning,  setBackupRunning]  = useState(false);
  const [backupError,    setBackupError]    = useState('');
  const [backupSuccess,  setBackupSuccess]  = useState('');
  const [restoreTarget,  setRestoreTarget]  = useState(null);  // filename to restore
  const [restoreRunning, setRestoreRunning] = useState(false);
  const [deleteTarget,   setDeleteTarget]   = useState(null);  // filename to delete
  const [deleteRunning,  setDeleteRunning]  = useState(false);

  // ── User load ──────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    getAllUsers()
      .then((r) => { if (r.success) setUsers(r.data); })
      .catch(() => setError('Failed to load users.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Wards for the nurse department picker. Active only — a retired ward has no
  // roster to join, and the API refuses it anyway.
  useEffect(() => {
    getAllDepartments()
      .then((r) => { if (r.success) setDepartments(r.data); })
      .catch(() => { /* non-fatal: the column just shows no options */ });
  }, []);

  const openDeptEditor = (row) => {
    setDeptChoice(row.department_id ? String(row.department_id) : '');
    setDeptTarget(row);
  };

  const handleDeptSave = async () => {
    if (!deptTarget) return;
    setError(''); setSuccess('');
    setDeptSaving(true);
    try {
      const res = await setEmployeeDepartment(deptTarget.linked_id, deptChoice ? Number(deptChoice) : null);
      setSuccess(res.message || 'Department updated.');
      setDeptTarget(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to set department.');
    } finally { setDeptSaving(false); }
  };

  // ── Backup list load ───────────────────────────────────────────────────────
  const loadBackups = useCallback(() => {
    setBackupsLoading(true);
    listBackups()
      .then((r) => { if (r.success) setBackups(r.data); })
      .catch(() => setBackupError('Could not load backup list.'))
      .finally(() => setBackupsLoading(false));
  }, []);
  useEffect(() => { if (BACKUPS_ENABLED) loadBackups(); }, [loadBackups, BACKUPS_ENABLED]);

  // ── User handlers ──────────────────────────────────────────────────────────
  const handleSave = async (data) => {
    setSaving(true);
    try {
      if (modal === 'new') await createUser(data);
      else await updateUser(modal.user_id, data);
      setSuccess(modal === 'new' ? 'User created.' : 'User updated.');
      setModal(null); load();
    } catch (err) { setError(err.response?.data?.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async () => {
    if (!confirm) return;
    setSaving(true);
    try {
      await deactivateUser(confirm.user_id);
      setSuccess(`${confirm.username} deactivated.`);
      setConfirm(null); load();
    } catch (err) { setError(err.response?.data?.message || 'Deactivation failed.'); }
    finally { setSaving(false); }
  };

  const handleReactivate = async () => {
    if (!reactivateConfirm) return;
    setSaving(true);
    try {
      await reactivateUser(reactivateConfirm.user_id);
      setSuccess(`${reactivateConfirm.username} reactivated.`);
      setReactivateConfirm(null); load();
    } catch (err) { setError(err.response?.data?.message || 'Reactivation failed.'); }
    finally { setSaving(false); }
  };

  // Enabling asks for an explanatory confirmation first; disabling goes
  // straight to password re-verification.
  const openDicToggle = (row) => {
    const enabled = !row.is_doctor_in_charge;
    setDicTarget({ row, enabled });
    setDicPassword('');
    setDicStep(enabled ? 'confirm' : 'password');
  };

  const closeDicFlow = () => { setDicTarget(null); setDicStep(null); setDicPassword(''); };

  const handleDicSubmit = async (e) => {
    e?.preventDefault();
    if (!dicTarget || !dicPassword) return;
    setDicSaving(true);
    try {
      const res = await setDoctorInCharge(dicTarget.row.user_id, dicTarget.enabled, dicPassword);
      setSuccess(res.message || 'Doctor-in-Charge updated.');
      closeDicFlow(); load();
    } catch (err) {
      setError(err.response?.data?.message || 'Doctor-in-Charge update failed.');
      closeDicFlow();
    } finally { setDicSaving(false); }
  };

  // ── Backup handler ─────────────────────────────────────────────────────────
  const handleCreateBackup = async () => {
    setBackupRunning(true);
    setBackupError('');
    setBackupSuccess('');
    try {
      const res = await createBackup();
      setBackupSuccess(`Backup created: ${res.filename} (${res.size})`);
      loadBackups();
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.message || 'Backup failed.';
      setBackupError(detail);
    } finally {
      setBackupRunning(false);
    }
  };

  // ── Restore handler ────────────────────────────────────────────────────────
  const handleRestore = async () => {
    if (!restoreTarget) return;
    setRestoreRunning(true);
    setBackupError('');
    setBackupSuccess('');
    try {
      const res = await restoreBackup(restoreTarget);
      setBackupSuccess(`✅ ${res.message}`);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.message || 'Restore failed.';
      setBackupError(`Restore failed: ${detail}`);
    } finally {
      setRestoreRunning(false);
      setRestoreTarget(null);
    }
  };

  // ── Delete handler — optimistic UI: remove from list immediately ───────────
  const handleDeleteBackup = async () => {
    if (!deleteTarget) return;
    setDeleteRunning(true);
    setBackupError('');
    setBackupSuccess('');
    // Optimistic update — remove from local list right away
    setBackups((prev) => prev.filter((b) => b.filename !== deleteTarget));
    try {
      await deleteBackup(deleteTarget);
      setBackupSuccess(`🗑️ Backup deleted: ${deleteTarget}`);
    } catch (err) {
      // Rollback: reload the list so the file reappears if delete actually failed
      loadBackups();
      const detail = err.response?.data?.detail || err.response?.data?.message || 'Delete failed.';
      setBackupError(`Delete failed: ${detail}`);
    } finally {
      setDeleteRunning(false);
      setDeleteTarget(null);
    }
  };

  // ── Table columns ──────────────────────────────────────────────────────────
  const userColumns = [
    { key:'username',  label:'Username',render:(r)=><span style={{fontWeight:600}}>{r.username}</span> },
    { key:'role',      label:'Role',    render:(r)=>(
      <span style={{display:'inline-flex',gap:'var(--space-2)',alignItems:'center'}}>
        <Badge status={r.role} label={ROLE_LABELS[r.role]??r.role} />
        {!!r.is_doctor_in_charge && <Badge status="Completed" label="DIC" />}
      </span>
    )},
    { key:'linked_name', label:'Full Name', render:(r)=>r.linked_name ?? '—', hideMobile: true },
    { key:'is_active', label:'Status',  render:(r)=>r.is_active ? <Badge status="Completed" label="Active" /> : <Badge status="Cancelled" label="Inactive" /> },
    { key:'created_at',label:'Created', render:(r)=>formatDate(r.created_at), hideMobile: true },
    {
      key:'actions', label:'', width:'360px', align:'right',
      render:(r)=>(
        // nowrap + 340px minimum fits the widest case (Edit / Demote to Doctor /
        // Deactivate) on a single right-aligned line, so 2- and 3-button rows
        // stay visually aligned; the table wrapper scrolls on narrow viewports
        <div style={{display:'flex',gap:'var(--space-2)',justifyContent:'flex-end',alignItems:'center',flexWrap:'nowrap',whiteSpace:'nowrap',minWidth:'340px'}}>
          <Button size="sm" variant="outline" onClick={(e)=>{e.stopPropagation();setModal(r);}}>Edit</Button>
          {r.role === 'doctor' && r.is_active && (
            <Button size="sm" variant={r.is_doctor_in_charge ? 'secondary' : 'outline'}
              onClick={(e)=>{e.stopPropagation();openDicToggle(r);}}>
              {r.is_doctor_in_charge ? 'Demote to Doctor' : 'Promote to DIC'}
            </Button>
          )}
          {r.is_active
            ? <Button size="sm" variant="danger"   onClick={(e)=>{e.stopPropagation();setConfirm(r);}}>Deactivate</Button>
            : <Button size="sm" variant="primary"  onClick={(e)=>{e.stopPropagation();setReactivateConfirm(r);}}>Reactivate</Button>
          }
        </div>
      ),
    },
  ];

  // Nurses get an extra Department column: their ward is what drives the ward
  // roster and shift endorsements, and only an admin can set it.
  const nurseColumns = [
    ...userColumns.slice(0, 3),
    {
      key: 'department_name', label: 'Department',
      render: (r) => (
        <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
          {r.department_name
            ? <span>{r.department_name}</span>
            : <span className="text-xs" style={{ color: 'var(--color-warning)' }}>Unassigned</span>}
          <Button size="sm" variant="ghost"
            style={{ padding: 0, height: 'auto', fontSize: 'var(--font-size-xs)' }}
            onClick={(e) => { e.stopPropagation(); openDeptEditor(r); }}>
            {r.department_name ? 'Change' : 'Set ward'}
          </Button>
        </span>
      ),
    },
    ...userColumns.slice(3),
  ];

  // ── Split users by role ────────────────────────────────────────────────────
  const doctors = users.filter((u) => u.role === 'doctor');
  const nurses  = users.filter((u) => u.role === 'nurse');

  // Subtitle count reflects what's shown: the filtered role's count when a
  // filter is active, otherwise the total.
  const roleCounts = { doctor: doctors.length, nurse: nurses.length };
  const shownCount = roleFilter ? (roleCounts[roleFilter] ?? 0) : users.length;
  const subtitle = roleFilter
    ? `${shownCount} ${roleFilter} account${shownCount !== 1 ? 's' : ''}`
    : `${shownCount} user account${shownCount !== 1 ? 's' : ''}`;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'var(--space-6)'}}>

      {/* ── User Management Header ──────────────────────────────────────────── */}
      <div style={{display:'flex',flexDirection:'column',gap:'var(--space-4)'}}>
        <div className="page-header">
          <div>
            <h1 className="page-title">User Management</h1>
            <p className="page-subtitle">{subtitle}</p>
          </div>
          <Button id="create-user-btn" variant="primary" onClick={()=>setModal('new')}>+ Add User</Button>
        </div>
        {error   && <Alert type="error"   message={error}   onDismiss={()=>setError('')}   />}
        {success && <Alert type="success" message={success} onDismiss={()=>setSuccess('')} />}
      </div>

      {/* ── Doctors ─────────────────────────────────────────────────────────── */}
      {(!roleFilter || roleFilter === 'doctor') && (
        <UserTableSection
          title="Doctors"
          rows={doctors}
          loading={loading}
          columns={userColumns}
          emptyMessage="No doctor accounts found."
          showDicFilter
          badgeStyle={{fontSize:'var(--font-size-xs)',background:'var(--color-info-muted)',color:'var(--color-info)',borderRadius:'var(--radius-full)',padding:'2px 10px',fontWeight:600}}
        />
      )}

      {/* ── Nurses ──────────────────────────────────────────────────────────── */}
      {(!roleFilter || roleFilter === 'nurse') && (
        <UserTableSection
          title="Nurses"
          rows={nurses}
          loading={loading}
          columns={nurseColumns}
          emptyMessage="No nurse accounts found."
          badgeStyle={{fontSize:'var(--font-size-xs)',background:'var(--color-success-muted)',color:'var(--color-success)',borderRadius:'var(--radius-full)',padding:'2px 10px',fontWeight:600}}
        />
      )}



      {/* ── Database Backup Section (local dev only — requires mysqldump) ──────── */}
      {BACKUPS_ENABLED && <Card
        title="Database Backup"
        action={
          <Button
            id="create-backup-btn"
            variant="primary"
            onClick={handleCreateBackup}
            loading={backupRunning}
          >
            {backupRunning ? 'Running backup…' : <><Download size={14} /> Create Backup</>}
          </Button>
        }
      >
        {backupError   && <Alert type="error"   message={backupError}   onDismiss={()=>setBackupError('')}   style={{marginBottom:'var(--space-4)'}} />}
        {backupSuccess && <Alert type="success" message={backupSuccess} onDismiss={()=>setBackupSuccess('')} style={{marginBottom:'var(--space-4)'}} />}

        <p style={{fontSize:'var(--font-size-sm)',color:'var(--color-text-muted)',marginBottom:'var(--space-4)'}}>
          Backups are exported via <code style={{background:'var(--color-surface-3)',padding:'1px 6px',borderRadius:'4px',fontSize:'0.85em'}}>mysqldump</code> and saved as <code style={{background:'var(--color-surface-3)',padding:'1px 6px',borderRadius:'4px',fontSize:'0.85em'}}>.sql</code> files on the server.
          Click <strong>Download</strong> to save a copy locally.
        </p>

        {/* Backup list */}
        {backupsLoading ? (
          <p style={{color:'var(--color-text-muted)',fontSize:'var(--font-size-sm)'}}>Loading backups…</p>
        ) : backups.length === 0 ? (
          <p style={{color:'var(--color-text-muted)',fontSize:'var(--font-size-sm)'}}>No backups yet. Click <strong>Create Backup</strong> to generate the first one.</p>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'var(--space-2)'}}>
            {/* Header row */}
            <div style={{
              display:'grid',
              gridTemplateColumns:'1fr auto auto auto',
              gap:'var(--space-4)',
              padding:'var(--space-2) var(--space-3)',
              fontSize:'var(--font-size-xs)',
              fontWeight:600,
              color:'var(--color-text-muted)',
              textTransform:'uppercase',
              letterSpacing:'0.05em',
              borderBottom:'1px solid var(--color-border)',
            }}>
              <span>Filename</span>
              <span style={{textAlign:'right'}}>Size</span>
              <span style={{textAlign:'right'}}>Age</span>
              <span style={{textAlign:'right'}}>Actions</span>
            </div>

            {/* Backup rows */}
            {backups.map((b) => (
              <div key={b.filename} style={{
                display:'grid',
                gridTemplateColumns:'1fr auto auto auto',
                gap:'var(--space-4)',
                alignItems:'center',
                padding:'var(--space-3)',
                background:'var(--color-surface-3)',
                borderRadius:'var(--radius-md)',
                border:'1px solid var(--color-border)',
                transition:'border-color 0.15s',
              }}>
                {/* Filename + download link */}
                <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)',minWidth:0}}>
                  <span style={{fontSize:'1.1rem'}}><Database size={18} /></span>
                  <a
                    href={getBackupDownloadUrl(b.filename)}
                    download={b.filename}
                    title={`Download ${b.filename}`}
                    style={{
                      fontSize:'var(--font-size-sm)',
                      color:'var(--color-primary)',
                      textDecoration:'none',
                      fontFamily:'monospace',
                      overflow:'hidden',
                      textOverflow:'ellipsis',
                      whiteSpace:'nowrap',
                    }}
                  >
                    {b.filename}
                  </a>
                </div>

                {/* Size */}
                <span style={{
                  fontSize:'var(--font-size-sm)',
                  color:'var(--color-text-muted)',
                  whiteSpace:'nowrap',
                  textAlign:'right',
                }}>
                  {b.size}
                </span>

                {/* Age */}
                <span style={{
                  fontSize:'var(--font-size-xs)',
                  color:'var(--color-text-muted)',
                  whiteSpace:'nowrap',
                  textAlign:'right',
                }}>
                  {relativeDate(b.created_at)}
                </span>

                {/* Actions: Download + Restore + Delete */}
                <div style={{display:'flex',alignItems:'center',gap:'var(--space-2)',justifyContent:'flex-end'}}>
                  <a href={getBackupDownloadUrl(b.filename)} download={b.filename}>
                    <Button size="sm" variant="outline" as="span"><Download size={14} /> Download</Button>
                  </a>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRestoreTarget(b.filename)}
                    title="Restore database from this backup"
                  >
                    <RotateCcw size={14} /> Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setDeleteTarget(b.filename)}
                    title="Permanently delete this backup file"
                  >
                    <Trash2 size={14} /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <Modal isOpen={!!modal} onClose={()=>setModal(null)} title={modal==='new'?'Create User':'Edit User'} size="md">
        <UserForm initial={modal==='new'?{}:modal??{}} onSubmit={handleSave} loading={saving} />
      </Modal>

      {/* ── Nurse ward assignment ── */}
      <Modal
        isOpen={!!deptTarget}
        onClose={() => setDeptTarget(null)}
        title={deptTarget ? `Department — ${deptTarget.linked_name ?? deptTarget.username}` : ''}
        size="sm"
      >
        {deptTarget && (
          <div>
            <div className="form-group">
              <label htmlFor="um-dept">Ward</label>
              <select id="um-dept" value={deptChoice} onChange={(e) => setDeptChoice(e.target.value)}>
                <option value="">— Unassigned —</option>
                {departments.map((d) => (
                  <option key={d.department_id} value={d.department_id}>
                    {d.name} ({d.room_count} bed{d.room_count !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted" style={{ marginTop: 'var(--space-3)' }}>
              A nurse sees the patients admitted to their ward, and can only endorse a shift to
              another nurse in it. Leaving this unassigned hides My Ward and Endorsements for them.
            </p>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setDeptTarget(null)}>Cancel</Button>
              <Button variant="primary" loading={deptSaving} onClick={handleDeptSave}>Save</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleDeactivate}
        title="Deactivate User"
        message={`Deactivate account "${confirm?.username}"? They will no longer be able to log in.`}
        confirmLabel="Deactivate"
        loading={saving}
      />

      <ConfirmDialog
        isOpen={!!reactivateConfirm}
        onClose={() => setReactivateConfirm(null)}
        onConfirm={handleReactivate}
        title="Reactivate User"
        message={`Reactivate account "${reactivateConfirm?.username}"? They will be able to log in again.`}
        confirmLabel="Reactivate"
        loading={saving}
      />

      {/* ── Doctor-in-Charge two-step flow ─────────────────────────────────── */}
      <ConfirmDialog
        isOpen={dicStep === 'confirm'}
        onClose={closeDicFlow}
        onConfirm={() => setDicStep('password')}
        title="Promote to Doctor-in-Charge"
        message={
          `Promote "${dicTarget?.row?.username}" to Doctor-in-Charge?\n\n` +
          `This grants elevated visibility: access to ALL patient records, ` +
          `the doctor workload overview, and the ability to reassign referrals. ` +
          `A maximum of 3 doctors can hold this promotion at once. ` +
          `You will be asked to re-enter your password to confirm.`
        }
        confirmLabel="Continue"
        variant="primary"
      />

      <Modal
        isOpen={dicStep === 'password'}
        onClose={closeDicFlow}
        title={dicTarget?.enabled ? 'Confirm — Promote to DIC' : 'Confirm — Demote to Doctor'}
        size="sm"
      >
        <form onSubmit={handleDicSubmit} noValidate>
          <p style={{ color:'var(--color-text-muted)', marginBottom:'var(--space-4)' }}>
            Re-enter your admin password to {dicTarget?.enabled
              ? <>promote <strong>{dicTarget?.row?.username}</strong> to Doctor-in-Charge</>
              : <>demote <strong>{dicTarget?.row?.username}</strong> to regular doctor</>}.
          </p>
          <div className="form-group">
            <label htmlFor="dic-pwd">Admin Password *</label>
            <input
              id="dic-pwd"
              type="password"
              value={dicPassword}
              onChange={(e) => setDicPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
          </div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={closeDicFlow} disabled={dicSaving}>Cancel</Button>
            <Button type="submit" variant="primary" loading={dicSaving} disabled={!dicPassword}>
              {dicTarget?.enabled ? 'Promote' : 'Demote'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Restore / Delete dialogs (backup-only) ─────────────────────────── */}
      {BACKUPS_ENABLED && <>
        <ConfirmDialog
          isOpen={!!restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onConfirm={handleRestore}
          title="Restore Database"
          message={
            `Are you sure you want to restore from:\n\n` +
            `"${restoreTarget}"\n\n` +
            `This will OVERWRITE ALL current data with the backup. ` +
            `This action cannot be undone.`
          }
          confirmLabel="Yes, Restore"
          loading={restoreRunning}
        />

        <ConfirmDialog
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteBackup}
          title="Delete Backup"
          message={
            `Permanently delete this backup file?\n\n` +
            `"${deleteTarget}"\n\n` +
            `This cannot be undone. Download a local copy first if you need to keep it.`
          }
          confirmLabel="Yes, Delete"
          loading={deleteRunning}
        />
      </>}
    </div>
  );
};

export default UserManagementPage;
