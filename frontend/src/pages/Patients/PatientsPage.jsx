import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllPatients, createPatient, updatePatient } from '../../api/patients.api';
import { useAuth } from '../../context/AuthContext';
import { canManagePatients } from '../../utils/roleGuard';
import { formatDate, calcAge } from '../../utils/formatDate';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import SearchBar from '../../components/ui/SearchBar';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import PatientForm from '../../components/forms/PatientForm';
import './PatientsPage.css';

const LIMIT = 20;

// Inline pill-style button used for pagination (matches Referrals page style)
const PillBtn = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: 'var(--space-2) var(--space-5)',
      borderRadius: 'var(--radius-full)',
      border: '1px solid var(--color-border)',
      background: 'transparent',
      color: disabled ? 'var(--color-text-disabled)' : 'var(--color-text-muted)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 'var(--font-size-sm)',
      fontWeight: 500,
      opacity: disabled ? 0.4 : 1,
      transition: 'all 0.15s',
    }}
  >
    {children}
  </button>
);

// Shared inline badge for unidentified patients
const UnidentifiedBadge = () => (
  <span style={{
    fontSize: 'var(--font-size-xs)', padding: '2px 8px',
    borderRadius: 'var(--radius-full)',
    background: 'var(--color-danger-muted)', color: 'var(--color-danger)',
    border: '1px solid var(--color-danger)', fontWeight: 600, whiteSpace: 'nowrap',
  }}>⚠ Unidentified</span>
);

const PatientsPage = () => {
  const { user }   = useAuth();
  const navigate   = useNavigate();

  // ── Filter state ─────────────────────────────────────────────
  const [search,    setSearch]    = useState('');
  const [sex,       setSex]       = useState('');
  const [fromDate,  setFromDate]  = useState('');
  const [toDate,    setToDate]    = useState('');

  // ── Pagination state ─────────────────────────────────────────
  const [page,  setPage]  = useState(1);
  const [total, setTotal] = useState(0);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  // ── Patient list state ────────────────────────────────────────
  const [patients,  setPatients]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [modal,     setModal]     = useState({ open: false, patient: null });
  const [saving,    setSaving]    = useState(false);

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [search, sex, fromDate, toDate]);

  // ── Data fetching ─────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);

    const params = { page, limit: LIMIT };
    if (search)   params.search    = search;
    if (sex)      params.sex       = sex;
    if (fromDate) params.from_date = fromDate;
    if (toDate)   params.to_date   = toDate;

    getAllPatients(params)
      .then((res) => {
        if (res.success) {
          setPatients(res.data);
          setTotal(res.total ?? res.data.length);
        }
      })
      .catch(() => setError('Failed to load patients.'))
      .finally(() => setLoading(false));
  }, [search, sex, fromDate, toDate, page]);

  useEffect(() => { load(); }, [load]);

  // Re-fetch patients list whenever a referral status changes (issue #12)
  useEffect(() => {
    const handleReferralUpdate = () => {
      load();
    };
    window.addEventListener('referral-status-updated', handleReferralUpdate);
    return () => window.removeEventListener('referral-status-updated', handleReferralUpdate);
  }, [load]);

  // ── Handlers ──────────────────────────────────────────────────
  const handleSave = async (data) => {
    setSaving(true);
    try {
      if (modal.patient) {
        await updatePatient(modal.patient.patient_id, data);
        setSuccess('Patient updated successfully.');
      } else {
        await createPatient(data);
        setSuccess('Patient registered successfully.');
      }
      setModal({ open: false, patient: null });
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed.');
    } finally { setSaving(false); }
  };

  const clearFilters = () => {
    setSearch('');
    setSex('');
    setFromDate('');
    setToDate('');
  };

  const hasActiveFilters = search || sex || fromDate || toDate;

  // ── Table columns (My Patients view) ─────────────────────────
  const columns = [
    { key: 'patient_id', label: 'ID', width: '60px', hideMobile: true },
    { key: 'full_name', label: 'Full Name', render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {r.first_name} {r.last_name}
        {r.is_unidentified ? <UnidentifiedBadge /> : null}
      </span>
    )},
    { key: 'sex',            label: 'Sex',       width: '80px' },
    { key: 'age',            label: 'Age',       width: '70px', render: (r) => calcAge(r.date_of_birth) },
    { key: 'contact_number', label: 'Contact', hideMobile: true },
    { key: 'created_at',     label: 'Registered', render: (r) => formatDate(r.created_at), hideMobile: true },
    {
      key: 'actions', label: '', width: '100px', align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost"
            onClick={(e) => { e.stopPropagation(); navigate(`/patients/${r.patient_id}`); }}>
            View
          </Button>
          {canManagePatients(user?.role) && (
            <Button size="sm" variant="outline"
              onClick={(e) => { e.stopPropagation(); setModal({ open: true, patient: r }); }}>
              Edit
            </Button>
          )}
        </div>
      ),
    },
  ];


  return (
    <div className="patients-page">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Patients</h2>
          <p className="page-subtitle">{total} patient{total !== 1 ? 's' : ''} found</p>
        </div>
        {canManagePatients(user?.role) && (
          <Button id="register-patient-btn" variant="primary"
            onClick={() => setModal({ open: true, patient: null })}>
            + Register Patient
          </Button>
        )}
      </div>

      {/* ── Alerts ── */}
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <>
          {/* ── Filter toolbar ── */}
          <div className="patients-toolbar">
            <SearchBar
              id="patient-search"
              value={search}
              onChange={setSearch}
              placeholder="Search by name or ID…"
            />
            <select
              id="patient-sex-filter"
              className="filter-select"
              value={sex}
              onChange={(e) => setSex(e.target.value)}
              aria-label="Filter by sex"
            >
              <option value="">All Sexes</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
            <div className="filter-date-group">
              <span className="filter-date-label">From</span>
              <input
                id="patient-from-date"
                type="date"
                className="filter-date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="Registered from date"
              />
            </div>
            <div className="filter-date-group">
              <span className="filter-date-label">To</span>
              <input
                id="patient-to-date"
                type="date"
                className="filter-date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Registered to date"
              />
            </div>
            {hasActiveFilters && (
              <button className="filter-clear-btn" onClick={clearFilters} title="Clear all filters">
                ✕ Clear
              </button>
            )}
          </div>

          {/* ── Patient list table ── */}
          <Table
            columns={columns}
            data={patients}
            loading={loading}
            emptyMessage="No patients match the current filters."
            onRowClick={(r) => navigate(`/patients/${r.patient_id}`)}
          />

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="patients-pagination">
              <span className="patients-pagination__info">
                Page <strong>{page}</strong> of <strong>{totalPages}</strong>
                &nbsp;·&nbsp;{total} total
              </span>
              <div className="patients-pagination__controls">
                <PillBtn onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
                  ← Previous
                </PillBtn>
                <PillBtn onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
                  Next →
                </PillBtn>
              </div>
            </div>
          )}
      </>

      {/* ── Register / Edit modal ── */}
      <Modal
        isOpen={modal.open}
        onClose={() => setModal({ open: false, patient: null })}
        title={modal.patient ? 'Edit Patient' : 'Register New Patient'}
        size="lg"
      >
        <PatientForm
          initial={modal.patient ?? {}}
          onSubmit={handleSave}
          loading={saving}
        />
      </Modal>

    </div>
  );
};

export default PatientsPage;
