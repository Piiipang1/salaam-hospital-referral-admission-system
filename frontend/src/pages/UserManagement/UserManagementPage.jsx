import { useEffect, useState, useCallback } from 'react';
import { Database, Download, RotateCcw, Trash2 } from 'lucide-react';
import { getAllUsers, createUser, updateUser, deactivateUser, reactivateUser, setDoctorInCharge } from '../../api/users.api';
import { createBackup, listBackups, getBackupDownloadUrl, restoreBackup, deleteBackup } from '../../api/backup.api';
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

const UserManagementPage = () => {
  const BACKUPS_ENABLED = import.meta.env.VITE_ENABLE_BACKUPS === 'true';

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
    { key:'linked_name', label:'Staff Member', render:(r)=>r.linked_name ?? '—', hideMobile: true },
    { key:'is_active', label:'Status',  render:(r)=>r.is_active ? <Badge status="Completed" label="Active" /> : <Badge status="Cancelled" label="Inactive" /> },
    { key:'created_at',label:'Created', render:(r)=>formatDate(r.created_at), hideMobile: true },
    {
      key:'actions', label:'', width:'300px', align:'right',
      render:(r)=>(
        // minWidth fits the widest case (Edit / Disable DIC / Deactivate) on one
        // line; below it the wrapper scrolls or the buttons wrap inside the cell
        <div style={{display:'flex',gap:'var(--space-2)',justifyContent:'flex-end',alignItems:'center',flexWrap:'wrap',minWidth:'280px'}}>
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

  // ── Split users by role ────────────────────────────────────────────────────
  const doctors = users.filter((u) => u.role === 'doctor');
  const nurses  = users.filter((u) => u.role === 'nurse');
  const staffs  = users.filter((u) => u.role === 'staff');

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'var(--space-6)'}}>

      {/* ── User Management Header ──────────────────────────────────────────── */}
      <div style={{display:'flex',flexDirection:'column',gap:'var(--space-4)'}}>
        <div className="page-header">
          <div>
            <h1 className="page-title">User Management</h1>
            <p className="page-subtitle">{users.length} user account{users.length!==1?'s':''}</p>
          </div>
          <Button id="create-user-btn" variant="primary" onClick={()=>setModal('new')}>+ Add User</Button>
        </div>
        {error   && <Alert type="error"   message={error}   onDismiss={()=>setError('')}   />}
        {success && <Alert type="success" message={success} onDismiss={()=>setSuccess('')} />}
      </div>

      {/* ── Doctors Table ───────────────────────────────────────────────────── */}
      <div style={{display:'flex',flexDirection:'column',gap:'var(--space-3)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)'}}>
          <h2 style={{margin:0,fontSize:'var(--font-size-lg)',fontWeight:700}}>Doctors</h2>
          <span style={{fontSize:'var(--font-size-xs)',background:'var(--color-info-muted)',color:'var(--color-info)',borderRadius:'var(--radius-full)',padding:'2px 10px',fontWeight:600}}>
            {loading ? '…' : doctors.length}
          </span>
        </div>
        <Table columns={userColumns} data={doctors} loading={loading} emptyMessage="No doctor accounts found." />
      </div>

      {/* ── Nurses Table ────────────────────────────────────────────────────── */}
      <div style={{display:'flex',flexDirection:'column',gap:'var(--space-3)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)'}}>
          <h2 style={{margin:0,fontSize:'var(--font-size-lg)',fontWeight:700}}>Nurses</h2>
          <span style={{fontSize:'var(--font-size-xs)',background:'var(--color-success-muted)',color:'var(--color-success)',borderRadius:'var(--radius-full)',padding:'2px 10px',fontWeight:600}}>
            {loading ? '…' : nurses.length}
          </span>
        </div>
        <Table columns={userColumns} data={nurses} loading={loading} emptyMessage="No nurse accounts found." />
      </div>

      {/* ── Staff Table ─────────────────────────────────────────────────────── */}
      <div style={{display:'flex',flexDirection:'column',gap:'var(--space-3)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'var(--space-3)'}}>
          <h2 style={{margin:0,fontSize:'var(--font-size-lg)',fontWeight:700}}>Staff</h2>
          <span style={{fontSize:'var(--font-size-xs)',background:'var(--color-warning-muted)',color:'var(--color-warning)',borderRadius:'var(--radius-full)',padding:'2px 10px',fontWeight:600}}>
            {loading ? '…' : staffs.length}
          </span>
        </div>
        <Table columns={userColumns} data={staffs} loading={loading} emptyMessage="No staff accounts found." />
      </div>


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
