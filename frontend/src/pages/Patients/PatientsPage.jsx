import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAllPatients, createPatient, updatePatient } from '../../api/patients.api';
import { createExternalReferral } from '../../api/referrals.api';
import { useAuth } from '../../context/AuthContext';
import { useCapacity } from '../../context/CapacityContext';
import { canManagePatients, canCreateExternalReferral } from '../../utils/roleGuard';
import { formatDate, todayInput } from '../../utils/formatDate';
import { formatPatientAge, formatPatientSex } from '../../utils/patientLabels';
import { NO_ROOMS_MESSAGE } from '../../utils/constants';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';
import SearchBar from '../../components/ui/SearchBar';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Alert from '../../components/ui/Alert';
import UnidentifiedBadge from '../../components/ui/UnidentifiedBadge';
import CapacityBanner from '../../components/ui/CapacityBanner';
import PatientForm from '../../components/forms/PatientForm';
import ExternalReferralForm from '../../components/forms/ExternalReferralForm';
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

const PatientsPage = () => {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  // No free bed → new registrations are closed. Editing an existing patient
  // stays available, so only the "new patient" path is gated.
  const { atCapacity } = useCapacity();

  // ER coordinator = admin or a Doctor-in-Charge. Gets the "Unassigned" filter.
  const isCoordinator = user?.role === 'admin' || (user?.role === 'doctor' && !!user?.is_doctor_in_charge);

  // Pre-apply a filter from the admin workflow stepper (e.g. ?registered=today)
  const [searchParams] = useSearchParams();
  const stepDate = searchParams.get('registered') === 'today' ? todayInput() : '';

  // ── Filter state ─────────────────────────────────────────────
  const [search,    setSearch]    = useState('');
  const [sex,       setSex]       = useState('');
  const [fromDate,  setFromDate]  = useState(stepDate);
  const [toDate,    setToDate]    = useState(stepDate);
  const [unassignedOnly, setUnassignedOnly] = useState(false);

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
  // External-referral modal: null when closed, else the patient row being
  // diverted (`{}` opens it with a searchable patient picker).
  const [referOut,  setReferOut]  = useState(null);

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [search, sex, fromDate, toDate, unassignedOnly]);

  // ── Data fetching ─────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);

    const params = { page, limit: LIMIT };
    if (search)         params.search     = search;
    if (sex)            params.sex        = sex;
    if (fromDate)       params.from_date  = fromDate;
    if (toDate)         params.to_date    = toDate;
    if (unassignedOnly) params.unassigned = 'true';

    getAllPatients(params)
      .then((res) => {
        if (res.success) {
          setPatients(res.data);
          setTotal(res.total ?? res.data.length);
        }
      })
      .catch(() => setError('Failed to load patients.'))
      .finally(() => setLoading(false));
  }, [search, sex, fromDate, toDate, unassignedOnly, page]);

  useEffect(() => { load(); }, [load]);

  // Re-fetch patients list whenever a referral status changes (issue #12)
  useEffect(() => {
    const handleReferralUpdate = () => {
      load();
    };
    window.addEventListener('referral-status-updated', handleReferralUpdate);
    return () => window.removeEventListener('referral-status-updated', handleReferralUpdate);
  }, [load]);

  // Auto-dismiss success alerts so a stale one can't linger above a later message
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(''), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // ── Handlers ──────────────────────────────────────────────────
  const handleSave = async (data) => {
    setError(''); setSuccess('');
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

  // Refer an already-registered patient out to another facility.
  const handleReferOut = async (formData) => {
    setError(''); setSuccess('');
    setSaving(true);
    try {
      const res = await createExternalReferral(formData);
      setSuccess(res.message || 'Patient referred to external hospital.');
      setReferOut(null);
    } catch (err) {
      setError(err.response?.data?.message || 'External referral failed.');
    } finally { setSaving(false); }
  };

  const clearFilters = () => {
    setSearch('');
    setSex('');
    setFromDate('');
    setToDate('');
    setUnassignedOnly(false);
  };

  const hasActiveFilters = search || sex || fromDate || toDate || unassignedOnly;

  // ── Table columns (My Patients view) ─────────────────────────
  const columns = [
    { key: 'full_name', label: 'Full Name', render: (r) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {r.first_name} {r.last_name}
        {r.is_unidentified ? <UnidentifiedBadge /> : null}
      </span>
    )},
    // Care status — the at-a-glance answer to "where is this patient in their
    // care?". Derived server-side from admissions, so it cannot disagree with
    // the Room column beside it.
    { key: 'care_status', label: 'Status', width: '150px', render: (r) => (
      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
        <Badge status={r.care_status ?? 'Waiting'} />
        {r.care_status_detail && (
          <span className="text-xs text-muted">{r.care_status_detail}</span>
        )}
      </span>
    )},
    { key: 'room', label: 'Room', render: (r) => r.room_type
        ? `${r.room_type} — ${r.bed_number}`
        : (r.admission_status === 'Pending Room' ? 'Awaiting room' : '—') },
    // Sex and age are demographic detail, not triage signal — hidden on a phone
    // so Status and Room (added this session) fit without the list scrolling
    // sideways. Both remain on the patient's own page.
    { key: 'sex',            label: 'Sex',       width: '80px', hideMobile: true, render: (r) => formatPatientSex(r) },
    { key: 'age',            label: 'Age',       width: '70px', hideMobile: true, render: (r) => formatPatientAge(r) },
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
          <h1 className="page-title">Patients</h1>
          <p className="page-subtitle">{total} patient{total !== 1 ? 's' : ''} found</p>
        </div>
        {canManagePatients(user?.role) ? (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            {/* Registration is blocked at zero availability — referring the
                patient onward is the action that IS still possible. */}
            {atCapacity && canCreateExternalReferral(user?.role) && (
              <Button id="refer-external-btn" variant="secondary"
                title="Refer a patient to a hospital outside this system"
                onClick={() => setReferOut({})}>
                Refer to External Hospital
              </Button>
            )}
            <Button id="register-patient-btn" variant="primary"
              disabled={atCapacity}
              title={atCapacity ? NO_ROOMS_MESSAGE : undefined}
              onClick={() => setModal({ open: true, patient: null })}>
              + Register Patient
            </Button>
          </div>
        ) : user?.role === 'admin' ? (
          <span style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            maxWidth: '340px',
            textAlign: 'right',
            lineHeight: 1.4,
          }}>
            Read-only oversight — patient registration and edits are performed by nurses.
          </span>
        ) : null}
      </div>

      {/* ── Alerts ── */}
      <CapacityBanner />
      {error   && <Alert type="error"   message={error}   onDismiss={() => setError('')}   />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <>
          {/* ── Filter toolbar ── */}
          <div className="patients-toolbar">
            <SearchBar
              id="patient-search"
              value={search}
              onChange={setSearch}
              placeholder="Search by patient name…"
            />
            {/* Second toolbar line: all remaining filters share one baseline */}
            <div className="patients-filter-row">
            <select
              id="patient-sex-filter"
              className="filter-select"
              value={sex}
              onChange={(e) => setSex(e.target.value)}
              aria-label="Filter by sex"
            >
              <option value="">Filter by sex</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
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
            {/* Unassigned-only toggle — ER coordinators (admin / Doctor-in-Charge) */}
            {isCoordinator && (
              <button
                type="button"
                className="filter-toggle-btn"
                onClick={() => setUnassignedOnly((v) => !v)}
                title="Show only patients with no doctor assigned yet"
                style={{
                  height: '38px',
                  padding: '0 var(--space-4)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid',
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  color:       unassignedOnly ? '#fff' : 'var(--color-text-muted)',
                  background:  unassignedOnly ? 'var(--color-primary)' : 'var(--color-surface-2)',
                  borderColor: unassignedOnly ? 'var(--color-primary)' : 'var(--color-border)',
                }}
              >
                Unassigned only
              </button>
            )}
            {hasActiveFilters && (
              <button className="filter-clear-btn" onClick={clearFilters} title="Clear all filters">
                ✕ Clear
              </button>
            )}
            </div>
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
          disabled={!modal.patient && atCapacity}
        />
      </Modal>

      {/* ── Refer to external hospital modal ── */}
      <Modal
        isOpen={!!referOut}
        onClose={() => setReferOut(null)}
        title="Refer to External Hospital"
        size="md"
      >
        {referOut && (
          <ExternalReferralForm
            patientId={referOut.patient_id}
            patientName={referOut.patient_id ? `${referOut.first_name} ${referOut.last_name}` : undefined}
            onSubmit={handleReferOut}
            loading={saving}
          />
        )}
      </Modal>

    </div>
  );
};

export default PatientsPage;
