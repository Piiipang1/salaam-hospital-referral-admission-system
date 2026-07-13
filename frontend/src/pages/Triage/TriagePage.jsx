import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Siren } from 'lucide-react';
import { getAllTriages, createTriage, createEmergencyTriage, assignTriageDoctor } from '../../api/triages.api';
import { getActiveDoctors } from '../../api/doctors.api';
import { useAuth } from '../../context/AuthContext';
import { canManageTriage, canEmergencyTriage } from '../../utils/roleGuard';
import { formatDate, todayInput } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import TriageForm from '../../components/forms/TriageForm';
import './TriagePage.css';

const TRIAGE_LEVELS = ['Critical', 'Urgent', 'Non-Urgent'];

// Level colour mapping for the filter pill buttons
const LEVEL_COLORS = {
  Critical:    { bg: 'var(--color-danger)',  muted: 'var(--color-danger-muted)'  },
  Urgent:      { bg: 'var(--color-warning)', muted: 'var(--color-warning-muted)' },
  'Non-Urgent':{ bg: 'var(--color-info)',    muted: 'var(--color-info-muted)'    },
};

const TriagePage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // ER coordinator = admin or a Doctor-in-Charge. Gets the "Unassigned" filter
  // and the "Assign doctor" action. Backend enforces the real permission.
  const isCoordinator = user?.role === 'admin' || (user?.role === 'doctor' && !!user?.is_doctor_in_charge);

  // Pre-apply a filter from the admin workflow stepper (?date=today)
  const [searchParams] = useSearchParams();
  const stepDate = searchParams.get('date') === 'today' ? todayInput() : '';

  // ── Filter state ─────────────────────────────────────────────
  const [level,    setLevel]    = useState('');
  const [fromDate, setFromDate] = useState(stepDate);
  const [toDate,   setToDate]   = useState(stepDate);
  const [unassignedOnly, setUnassignedOnly] = useState(false);

  // ── Assign-doctor modal state (coordinator) ──────────────────
  const [assignTarget,   setAssignTarget]   = useState(null); // triage row
  const [assignDoctorId, setAssignDoctorId] = useState('');
  const [assignSaving,   setAssignSaving]   = useState(false);

  // ── Data / UI state ──────────────────────────────────────────
  const [data,    setData]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [modal,   setModal]   = useState(false);
  const [saving,  setSaving]  = useState(false);

  // ── Emergency triage modal state ─────────────────────────────
  const [emergencyModal,  setEmergencyModal]  = useState(false);
  const [emergencyForm,   setEmergencyForm]   = useState({ triage_level: 'Critical', notes: '' });
  const [emergencySaving, setEmergencySaving] = useState(false);
  const [etDoctors,       setEtDoctors]       = useState([]);
  const [etDoctorsFetching, setEtDoctorsFetching] = useState(true);

  // Fetch active doctors for the coordinator's assign-doctor modal dropdown
  useEffect(() => {
    if (!isCoordinator) return;
    getActiveDoctors()
      .then((r) => { if (r.success) setEtDoctors(r.data); })
      .catch(() => {})
      .finally(() => setEtDoctorsFetching(false));
  }, [isCoordinator]);

  // ── Data fetching ─────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (level)          params.level      = level;
    if (fromDate)       params.from_date  = fromDate;
    if (toDate)         params.to_date    = toDate;
    if (unassignedOnly) params.unassigned = 'true';

    getAllTriages(params)
      .then((r) => {
        if (r.success) {
          setData(r.data);
          setTotal(r.total ?? r.data.length);
        }
      })
      .catch(() => setError('Failed to load triages.'))
      .finally(() => setLoading(false));
  }, [level, fromDate, toDate, unassignedOnly]);

  useEffect(() => { load(); }, [load]);

  // ── Handlers ──────────────────────────────────────────────────
  const handleCreate = async (form) => {
    setSaving(true);
    try {
      await createTriage(form);
      setSuccess('Triage recorded.');
      setModal(false);
      load();
    } catch (err) { setError(err.response?.data?.message || 'Failed to save triage.'); }
    finally { setSaving(false); }
  };

  const handleEmergencyTriage = async () => {
    setEmergencySaving(true);
    try {
      const result = await createEmergencyTriage(emergencyForm);
      setEmergencyModal(false);
      navigate(`/patients/${result.patient_id}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Emergency triage failed.');
    } finally {
      setEmergencySaving(false);
    }
  };

  // Coordinator assigns/changes the attending doctor for a triage's patient.
  const handleAssignDoctor = async () => {
    if (!assignTarget || !assignDoctorId) return;
    setAssignSaving(true);
    try {
      const res = await assignTriageDoctor(assignTarget.triage_id, assignDoctorId);
      setSuccess(res.message || 'Attending doctor assigned.');
      setAssignTarget(null);
      setAssignDoctorId('');
      load(); // patient leaves the coordinator's list once assigned to another doctor
    } catch (err) {
      if (err.response?.status === 403) {
        setError('Doctor-in-Charge coordination is no longer active on your account.');
        setAssignTarget(null);
      } else {
        setError(err.response?.data?.message || 'Assignment failed.');
      }
    } finally { setAssignSaving(false); }
  };

  const clearFilters = () => { setLevel(''); setFromDate(''); setToDate(''); setUnassignedOnly(false); };
  const hasActiveFilters = level || fromDate || toDate || unassignedOnly;

  // ── Table columns ─────────────────────────────────────────────
  const columns = [
    { key: 'patient_name',    label: 'Patient',   render: (r) => r.patient_name || 'Unknown Patient' },
    { key: 'triage_level',    label: 'Level',     render: (r) => <Badge status={r.triage_level} /> },
    { key: 'triage_datetime', label: 'Date/Time', render: (r) => formatDate(r.triage_datetime, true) },
    { key: 'notes',           label: 'Notes',     hideMobile: true, render: (r) => (
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          {r.notes ? r.notes.substring(0, 60) + (r.notes.length > 60 ? '…' : '') : '—'}
        </span>
      ),
    },
    { key: 'actions', label: '', width: isCoordinator ? '180px' : '80px', align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          {isCoordinator && (
            <Button size="sm" variant="outline"
              title="Assign or change the attending doctor"
              onClick={(e) => { e.stopPropagation(); setAssignDoctorId(''); setAssignTarget(r); }}>
              Assign doctor
            </Button>
          )}
          <Button size="sm" variant="ghost"
            onClick={(e) => { e.stopPropagation(); navigate(`/triage/${r.triage_id}`); }}>
            View
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="triage-page">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Triage</h1>
          <p className="page-subtitle">
            {total} triage record{total !== 1 ? 's' : ''}
            {hasActiveFilters ? ' (filtered)' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          {canEmergencyTriage(user?.role) && (
            <Button
              variant="danger"
              onClick={() => { setEmergencyForm({ triage_level: 'Critical', notes: '' }); setEmergencyModal(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <Siren size={16} /> Emergency Triage
            </Button>
          )}
          {canManageTriage(user?.role) && (
            <Button id="create-triage-btn" variant="primary" onClick={() => setModal(true)}>
              + Record Triage
            </Button>
          )}
        </div>
      </div>

      {/* ── Alerts ── */}
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      {/* ── Filter toolbar ── */}
      <div className="triage-toolbar">

        {/* Triage level pills */}
        <div className="triage-level-pills">
          <button
            className={`triage-level-pill${level === '' ? ' triage-level-pill--active' : ''}`}
            onClick={() => setLevel('')}
            style={level === '' ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : {}}
          >
            All
          </button>
          {TRIAGE_LEVELS.map((lvl) => {
            const active = level === lvl;
            const colors = LEVEL_COLORS[lvl];
            return (
              <button
                key={lvl}
                className={`triage-level-pill${active ? ' triage-level-pill--active' : ''}`}
                onClick={() => setLevel(active ? '' : lvl)}
                style={active
                  ? { background: colors.bg, borderColor: colors.bg, color: '#fff' }
                  : { borderColor: colors.bg, color: colors.bg }
                }
              >
                {lvl}
              </button>
            );
          })}
        </div>

        {/* Date range */}
        <div className="triage-date-range">
          <div className="filter-date-group">
            <span className="filter-date-label">From</span>
            <input
              id="triage-from-date"
              type="date"
              className="filter-date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="Triage from date"
            />
          </div>
          <div className="filter-date-group">
            <span className="filter-date-label">To</span>
            <input
              id="triage-to-date"
              type="date"
              className="filter-date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              aria-label="Triage to date"
            />
          </div>
        </div>

        {/* Unassigned-only toggle — ER coordinators (admin / Doctor-in-Charge) */}
        {isCoordinator && (
          <button
            className={`triage-level-pill${unassignedOnly ? ' triage-level-pill--active' : ''}`}
            onClick={() => setUnassignedOnly((v) => !v)}
            style={unassignedOnly
              ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' }
              : {}}
            title="Show only patients with no doctor assigned yet"
          >
            Unassigned only
          </button>
        )}

        {/* Clear button */}
        {hasActiveFilters && (
          <button className="filter-clear-btn" onClick={clearFilters} title="Clear all filters">
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── Data table ── */}
      <Table
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="No triage records match the current filters."
        onRowClick={(r) => navigate(`/triage/${r.triage_id}`)}
      />

      {/* ── Create triage modal ── */}
      <Modal isOpen={modal} onClose={() => setModal(false)} title="Record Triage" size="md">
        <TriageForm onSubmit={handleCreate} loading={saving} />
      </Modal>

      {/* ── Assign attending doctor modal (ER coordinator) ── */}
      <Modal isOpen={!!assignTarget} onClose={() => setAssignTarget(null)} title="Assign Attending Doctor" size="sm">
        <p className="text-sm text-muted" style={{ marginBottom: 'var(--space-4)' }}>
          Set the attending doctor for <strong>{assignTarget?.patient_name || 'this patient'}</strong>.
          Once assigned to another doctor, this patient leaves your coordination list.
        </p>
        <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
          <label htmlFor="assign-doctor-select">Doctor *</label>
          <select id="assign-doctor-select" value={assignDoctorId} onChange={(e) => setAssignDoctorId(e.target.value)} required disabled={etDoctorsFetching}>
            <option value="">— Select doctor —</option>
            {etDoctors.map((d) => (
              <option key={d.doctor_id} value={d.doctor_id}>
                Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setAssignTarget(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleAssignDoctor} loading={assignSaving} disabled={!assignDoctorId}>Assign</Button>
        </div>
      </Modal>

      {/* ── Emergency triage modal ── */}
      <Modal isOpen={emergencyModal} onClose={() => setEmergencyModal(false)} title="Emergency Triage" size="sm">
        <div className="form-group">
          <label htmlFor="et-level">Triage Level</label>
          <select
            id="et-level"
            value={emergencyForm.triage_level}
            onChange={(e) => setEmergencyForm((f) => ({ ...f, triage_level: e.target.value }))}
          >
            {TRIAGE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
          <label htmlFor="et-notes">Chief Complaint / Notes</label>
          <textarea
            id="et-notes"
            rows={3}
            value={emergencyForm.notes}
            onChange={(e) => setEmergencyForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Describe presenting complaint or condition…"
          />
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => setEmergencyModal(false)}>Cancel</Button>
          <Button type="button" variant="danger" loading={emergencySaving} onClick={handleEmergencyTriage}>
            Start Emergency Triage
          </Button>
        </div>
      </Modal>

    </div>
  );
};

export default TriagePage;
