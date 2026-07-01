import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Siren } from 'lucide-react';
import { getAllTriages, createTriage, createEmergencyTriage } from '../../api/triages.api';
import { getActiveDoctors } from '../../api/doctors.api';
import { useAuth } from '../../context/AuthContext';
import { canManageTriage, canEmergencyTriage } from '../../utils/roleGuard';
import { formatDate } from '../../utils/formatDate';
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

  // ── Filter state ─────────────────────────────────────────────
  const [level,    setLevel]    = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate,   setToDate]   = useState('');

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
  const [emergencyForm,   setEmergencyForm]   = useState({ triage_level: 'Critical', notes: '', assigned_doctor_id: '' });
  const [emergencySaving, setEmergencySaving] = useState(false);
  const [etDoctors,       setEtDoctors]       = useState([]);
  const [etDoctorsFetching, setEtDoctorsFetching] = useState(true);

  // Fetch active doctors once for the emergency modal doctor dropdown
  useEffect(() => {
    getActiveDoctors()
      .then((r) => { if (r.success) setEtDoctors(r.data); })
      .catch(() => {})
      .finally(() => setEtDoctorsFetching(false));
  }, []);

  // ── Data fetching ─────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (level)    params.level     = level;
    if (fromDate) params.from_date = fromDate;
    if (toDate)   params.to_date   = toDate;

    getAllTriages(params)
      .then((r) => {
        if (r.success) {
          setData(r.data);
          setTotal(r.total ?? r.data.length);
        }
      })
      .catch(() => setError('Failed to load triages.'))
      .finally(() => setLoading(false));
  }, [level, fromDate, toDate]);

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

  const clearFilters = () => { setLevel(''); setFromDate(''); setToDate(''); };
  const hasActiveFilters = level || fromDate || toDate;

  // ── Table columns ─────────────────────────────────────────────
  const columns = [
    { key: 'triage_id',       label: 'ID',        width: '60px' },
    { key: 'patient_name',    label: 'Patient',   render: (r) => r.patient_name || `Patient #${r.patient_id}` },
    { key: 'triage_level',    label: 'Level',     render: (r) => <Badge status={r.triage_level} /> },
    { key: 'triage_datetime', label: 'Date/Time', render: (r) => formatDate(r.triage_datetime, true) },
    { key: 'notes',           label: 'Notes',     render: (r) => (
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          {r.notes ? r.notes.substring(0, 60) + (r.notes.length > 60 ? '…' : '') : '—'}
        </span>
      ),
    },
    { key: 'actions', label: '', width: '80px', align: 'right',
      render: (r) => (
        <Button size="sm" variant="ghost"
          onClick={(e) => { e.stopPropagation(); navigate(`/triage/${r.triage_id}`); }}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="triage-page">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Triage</h2>
          <p className="page-subtitle">
            {total} triage record{total !== 1 ? 's' : ''}
            {hasActiveFilters ? ' (filtered)' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          {canEmergencyTriage(user?.role) && (
            <Button
              variant="danger"
              onClick={() => { setEmergencyForm({ triage_level: 'Critical', notes: '', assigned_doctor_id: '' }); setEmergencyModal(true); }}
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
          <input
            id="triage-from-date"
            type="date"
            className="filter-date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            title="From date"
            aria-label="Triage from date"
          />
          <span className="filter-date-sep">—</span>
          <input
            id="triage-to-date"
            type="date"
            className="filter-date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            title="To date"
            aria-label="Triage to date"
          />
        </div>

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
        <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
          <label htmlFor="et-doctor">Assign to Doctor</label>
          <select
            id="et-doctor"
            value={emergencyForm.assigned_doctor_id}
            onChange={(e) => setEmergencyForm((f) => ({ ...f, assigned_doctor_id: e.target.value }))}
            disabled={etDoctorsFetching}
          >
            <option value="">— Leave unassigned (add to pool) —</option>
            {etDoctors.map((d) => (
              <option key={d.doctor_id} value={d.doctor_id}>
                Dr. {d.first_name} {d.last_name}{d.specialization ? ` (${d.specialization})` : ''}
              </option>
            ))}
          </select>
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
